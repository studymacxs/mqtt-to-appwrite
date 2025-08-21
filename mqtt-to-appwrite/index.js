import mqtt from 'mqtt';
import { Client, Databases, ID, Query } from 'node-appwrite';
import { ulid } from 'ulid';

const {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY,
  APPWRITE_DB_ID,
  COLL_PLANTS = 'plants',
  COLL_SENSOR = 'plant_sensor_data',
  MQTT_URL = 'mqtt://localhost:1883',
  MQTT_USERNAME,
  MQTT_PASSWORD,
  UPSERT_PLANT_ON_SEEN = 'true',
  FLUSH_IS_CURRENT = 'true',
  BATCH_INSERT = 'false'
} = process.env;

// ---- Appwrite Client
const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const db = new Databases(client);

// helper: safe parse
const parseJson = (buf) => {
  try { return JSON.parse(buf.toString()); }
  catch (e) { return null; }
};

const isoOrNull = (s) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const makeSensorId = (plantId, ts) => `sd_${plantId}_${ts}`.replace(/[^a-zA-Z0-9_-]/g, '');

async function ensurePlantExists(plant_id) {
  try {
    const res = await db.listDocuments(APPWRITE_DB_ID, COLL_PLANTS, [
      Query.equal('plant_id', plant_id),
      Query.limit(1)
    ]);
    if (res.total === 0) {
      // Minimal-Insert, du kannst name/ideal-Werte später pflegen
      await db.createDocument(APPWRITE_DB_ID, COLL_PLANTS, ID.unique(), {
        plant_id,
        name: plant_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } else {
      // touch updated_at
      await db.updateDocument(APPWRITE_DB_ID, COLL_PLANTS, res.documents[0].$id, {
        updated_at: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error('ensurePlantExists error', err?.message || err);
  }
}

async function setCurrentExclusive(plant_id, newDocId) {
  if (FLUSH_IS_CURRENT !== 'true') return;
  try {
    // alle current=false setzen, außer neuem
    // (Appwrite hat keine Multi-Update; wir holen die aktuellen und setzen um)
    const current = await db.listDocuments(APPWRITE_DB_ID, COLL_SENSOR, [
      Query.equal('plant_id', plant_id),
      Query.equal('is_current', true),
      Query.limit(100) // falls viele, ggf. paginieren
    ]);
    const ops = current.documents
      .filter(d => d.$id !== newDocId)
      .map(d => db.updateDocument(APPWRITE_DB_ID, COLL_SENSOR, d.$id, { is_current: false }));
    await Promise.allSettled(ops);
  } catch (err) {
    console.error('setCurrentExclusive error', err?.message || err);
  }
}

async function upsertSensorData({ plant_id, timestamp, temperature, light, humidity, sensor_data_id }) {
  const tsISO = isoOrNull(timestamp) || new Date().toISOString();
  const sid = sensor_data_id || makeSensorId(plant_id, tsISO);

  // idempotent: existiert schon?
  const existing = await db.listDocuments(APPWRITE_DB_ID, COLL_SENSOR, [
    Query.equal('sensor_data_id', sid),
    Query.limit(1)
  ]);

  if (existing.total > 0) {
    // optional: Update (z. B. wenn Nachlieferung korrigierter Werte)
    const docId = existing.documents[0].$id;
    await db.updateDocument(APPWRITE_DB_ID, COLL_SENSOR, docId, {
      plant_id, timestamp: tsISO, temperature, light, humidity,
      is_current: true // wird gleich exklusiv gemacht
    });
    await setCurrentExclusive(plant_id, docId);
    return docId;
  } else {
    const doc = await db.createDocument(APPWRITE_DB_ID, COLL_SENSOR, ID.unique(), {
      sensor_data_id: sid,
      plant_id,
      timestamp: tsISO,
      temperature,
      light,
      humidity,
      is_current: true,
      created_at: new Date().toISOString()
    });
    await setCurrentExclusive(plant_id, doc.$id);
    return doc.$id;
  }
}

// ---- MQTT Client
const mqttOpts = {};
if (MQTT_USERNAME) mqttOpts.username = MQTT_USERNAME;
if (MQTT_PASSWORD) mqttOpts.password = MQTT_PASSWORD;

const clientMqtt = mqtt.connect(MQTT_URL, mqttOpts);

clientMqtt.on('connect', () => {
  console.log('MQTT connected:', MQTT_URL);
  // Wildcard für alle Pflanzen
  clientMqtt.subscribe('plants/+/telemetry', { qos: 1 }, (err) => {
    if (err) console.error('Subscribe error', err);
    else console.log('Subscribed to plants/+/telemetry');
  });
});

clientMqtt.on('message', async (topic, payloadBuf) => {
  try {
    const m = parseJson(payloadBuf);
    if (!m) return console.warn('Invalid JSON payload');

    const [, plant_id] = topic.split('/'); // plants/<plant_id>/telemetry
    if (!plant_id) return console.warn('No plant_id in topic');

    const { timestamp, temperature, light, humidity, sensor_data_id } = m;

    if (UPSERT_PLANT_ON_SEEN === 'true') {
      await ensurePlantExists(plant_id);
    }

    if (typeof temperature !== 'number' || typeof light !== 'number' || typeof humidity !== 'number') {
      return console.warn('Missing/invalid fields', { temperature, light, humidity });
    }

    const did = await upsertSensorData({ plant_id, timestamp, temperature, light, humidity, sensor_data_id });
    console.log('Upserted sensor doc', did, 'for plant', plant_id);

  } catch (err) {
    console.error('message handler error', err?.message || err);
  }
});

clientMqtt.on('error', (e) => console.error('MQTT error', e?.message || e));
