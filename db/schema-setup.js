// schema-setup.js
import { Client, Databases, Storage, Permission, Role } from "node-appwrite";

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT) // z.B. 'https://fra.cloud.appwrite.io/v1'
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);
const storage = new Storage(client);

// ---- IDs (frei wählbar, stabil halten) ----
const DATABASE_ID = "plants-db";
const PLANTS = "plants";
const SENSOR = "plant_sensor_data";
const CHAT_SESSIONS = "chat_sessions";
const CHAT_MESSAGES = "chat_messages";
const BUCKET_ID = "plant-images";

// Utility: idempotent create-or-get
async function ensureDatabase() {
  try {
    return await databases.get(DATABASE_ID);
  } catch {
    return await databases.create(DATABASE_ID, "Plants Database");
  }
}

async function ensureCollection(id, name, permissions = []) {
  try {
    return await databases.getCollection(DATABASE_ID, id);
  } catch {
    return await databases.createCollection(DATABASE_ID, id, name, permissions);
  }
}

async function ensureBucket() {
  try {
    return await storage.getBucket(BUCKET_ID);
  } catch {
    // Public read, authenticated write
    return await storage.createBucket(BUCKET_ID, "plant-images", [
      Permission.read(Role.any()),         // öffentlich lesen
      Permission.create(Role.users()),     // nur eingeloggte User/Services können hochladen
      Permission.update(Role.users()),
      Permission.delete(Role.users()),
    ], {
      // Optional-Parameter je nach Appwrite-Version:
      maximumFileSize: 10 * 1024 * 1024,   // 10MB
      allowedFileExtensions: ["jpg", "jpeg", "png", "webp"],
      fileSecurity: true,                  // Permissions pro Datei
      encryption: true,
      antivirus: false,                    // ggf. aktivieren, wenn verfügbar
      // compression: "gzip",              // Nur setzen, falls Version unterstützt
    });
  }
}

async function ensureStringAttr(colId, key, size, required, defaultVal = undefined) {
  try {
    await databases.getAttribute(DATABASE_ID, colId, key);
  } catch {
    await databases.createStringAttribute(DATABASE_ID, colId, key, size, required, defaultVal);
  }
}

async function ensureFloatAttr(colId, key, required, defaultVal = undefined) {
  try {
    await databases.getAttribute(DATABASE_ID, colId, key);
  } catch {
    await databases.createFloatAttribute(DATABASE_ID, colId, key, required, defaultVal);
  }
}

async function ensureIntegerAttr(colId, key, required, defaultVal = undefined) {
  try {
    await databases.getAttribute(DATABASE_ID, colId, key);
  } catch {
    await databases.createIntegerAttribute(DATABASE_ID, colId, key, required, defaultVal);
  }
}

async function ensureBooleanAttr(colId, key, required, defaultVal = undefined) {
  try {
    await databases.getAttribute(DATABASE_ID, colId, key);
  } catch {
    await databases.createBooleanAttribute(DATABASE_ID, colId, key, required, defaultVal);
  }
}

async function ensureDatetimeAttr(colId, key, required, defaultVal = undefined) {
  try {
    await databases.getAttribute(DATABASE_ID, colId, key);
  } catch {
    await databases.createDatetimeAttribute(DATABASE_ID, colId, key, required, defaultVal);
  }
}

async function ensureEnumAttr(colId, key, elements, required, defaultVal = undefined) {
  try {
    await databases.getAttribute(DATABASE_ID, colId, key);
  } catch {
    await databases.createEnumAttribute(DATABASE_ID, colId, key, elements, required, defaultVal);
  }
}

// Relationship-Attribut (One-to-Many/Many-to-One)
async function ensureRelationshipAttr({
  colId,
  key,
  relatedCollectionId,
  type = "oneToMany", // "oneToOne" | "oneToMany" | "manyToOne" | "manyToMany"
  twoWay = false,
  twoWayKey = undefined,
  onDelete = "restrict", // "cascade" | "restrict" | "setNull"
}) {
  try {
    await databases.getAttribute(DATABASE_ID, colId, key);
  } catch {
    await databases.createRelationshipAttribute(
      DATABASE_ID,
      colId,
      key,
      relatedCollectionId,
      type,
      twoWay,
      twoWayKey,
      onDelete
    );
  }
}

async function ensureIndex(colId, key, type, attributes, orders = []) {
  try {
    await databases.getIndex(DATABASE_ID, colId, key);
  } catch {
    await databases.createIndex(DATABASE_ID, colId, key, type, attributes, orders);
  }
}

async function main() {
  await ensureDatabase();

  // -----------------------
  // Collection: plants
  // -----------------------
  await ensureCollection(PLANTS, "plants", [
    Permission.read(Role.any()),            // öffentlich lesbar (optional)
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ]);

  await ensureStringAttr(PLANTS, "plant_id", 128, true);
  await ensureStringAttr(PLANTS, "name", 100, true);
  await ensureStringAttr(PLANTS, "description", 500, false);
  await ensureStringAttr(PLANTS, "image_file_id", 256, false);
  await ensureStringAttr(PLANTS, "image_url", 512, false); // optional: Regex-Validierung separat
  await ensureFloatAttr(PLANTS, "ideal_temp_min", true);
  await ensureFloatAttr(PLANTS, "ideal_temp_max", true);
  await ensureIntegerAttr(PLANTS, "ideal_light_min", true);
  await ensureIntegerAttr(PLANTS, "ideal_light_max", true);
  await ensureFloatAttr(PLANTS, "ideal_humidity_min", true);
  await ensureFloatAttr(PLANTS, "ideal_humidity_max", true);
  await ensureDatetimeAttr(PLANTS, "created_at", true);
  await ensureDatetimeAttr(PLANTS, "updated_at", true);

  // Eindeutigkeit von plant_id (Unique Index)
  await ensureIndex(PLANTS, "uniq_plant_id", "unique", ["plant_id"]);

  // -----------------------
  // Collection: plant_sensor_data
  // -----------------------
  await ensureCollection(SENSOR, "plant_sensor_data", [
    Permission.read(Role.any()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ]);

  await ensureStringAttr(SENSOR, "sensor_data_id", 128, true);
  await ensureDatetimeAttr(SENSOR, "timestamp", true);
  await ensureFloatAttr(SENSOR, "temperature", true);
  await ensureIntegerAttr(SENSOR, "light", true);
  await ensureFloatAttr(SENSOR, "humidity", true);
  await ensureBooleanAttr(SENSOR, "is_current", true, false);
  await ensureDatetimeAttr(SENSOR, "created_at", true);

  // Relationship: plant_sensor_data.plant_id -> plants (manyToOne)
  await ensureRelationshipAttr({
    colId: SENSOR,
    key: "plant_id",
    relatedCollectionId: PLANTS,
    type: "manyToOne",
    twoWay: false,
    onDelete: "cascade", // wenn eine Pflanze gelöscht wird, Messungen mitlöschen (fachlich prüfen!)
  });

  // Indizes für schnelle Abfragen (z. B. Messungen pro Pflanze nach Zeit)
  await ensureIndex(SENSOR, "by_plant_ts", "key", ["plant_id", "timestamp"], ["ASC", "DESC"]);
  await ensureIndex(SENSOR, "uniq_sensor_data_id", "unique", ["sensor_data_id"]);
  await ensureIndex(SENSOR, "current_by_plant", "key", ["plant_id", "is_current"], ["ASC", "DESC"]);

  // -----------------------
  // Collection: chat_sessions
  // -----------------------
  await ensureCollection(CHAT_SESSIONS, "chat_sessions", [
    Permission.read(Role.users()),   // Chats i. d. R. nicht öffentlich
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ]);

  await ensureStringAttr(CHAT_SESSIONS, "session_id", 128, true);
  await ensureStringAttr(CHAT_SESSIONS, "user_id", 128, false);
  await ensureStringAttr(CHAT_SESSIONS, "session_name", 100, false);
  await ensureBooleanAttr(CHAT_SESSIONS, "is_active", true, true);
  await ensureDatetimeAttr(CHAT_SESSIONS, "created_at", true);
  await ensureDatetimeAttr(CHAT_SESSIONS, "last_message_at", true);

  // Optionaler Pflanzenkontext: chat_sessions.plant_context_id -> plants (manyToOne)
  await ensureRelationshipAttr({
    colId: CHAT_SESSIONS,
    key: "plant_context_id",
    relatedCollectionId: PLANTS,
    type: "manyToOne",
    twoWay: false,
    onDelete: "setNull",
  });

  await ensureIndex(CHAT_SESSIONS, "uniq_session_id", "unique", ["session_id"]);
  await ensureIndex(CHAT_SESSIONS, "by_user_recent", "key", ["user_id", "last_message_at"], ["ASC", "DESC"]);

  // -----------------------
  // Collection: chat_messages
  // -----------------------
  await ensureCollection(CHAT_MESSAGES, "chat_messages", [
    Permission.read(Role.users()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ]);

  await ensureStringAttr(CHAT_MESSAGES, "message_id", 128, true);
  await ensureEnumAttr(CHAT_MESSAGES, "role", ["user", "assistant"], true);
  await ensureStringAttr(CHAT_MESSAGES, "content", 2000, true);
  await ensureEnumAttr(CHAT_MESSAGES, "message_type", ["text", "plant_data", "recommendation"], false);
  await ensureStringAttr(CHAT_MESSAGES, "metadata", 1000, false);
  await ensureDatetimeAttr(CHAT_MESSAGES, "timestamp", true);
  await ensureDatetimeAttr(CHAT_MESSAGES, "created_at", true);

  // Beziehungen:
  // chat_messages.session_id -> chat_sessions (manyToOne)
  await ensureRelationshipAttr({
    colId: CHAT_MESSAGES,
    key: "session_id",
    relatedCollectionId: CHAT_SESSIONS,
    type: "manyToOne",
    twoWay: false,
    onDelete: "cascade",
  });

  // optionaler Kontext: chat_messages.plant_context_id -> plants (manyToOne)
  await ensureRelationshipAttr({
    colId: CHAT_MESSAGES,
    key: "plant_context_id",
    relatedCollectionId: PLANTS,
    type: "manyToOne",
    twoWay: false,
    onDelete: "setNull",
  });

  // Indizes (häufige Abfragen: Nachrichten einer Session zeitlich sortiert)
  await ensureIndex(CHAT_MESSAGES, "by_session_ts", "key", ["session_id", "timestamp"], ["ASC", "ASC"]);
  await ensureIndex(CHAT_MESSAGES, "uniq_message_id", "unique", ["message_id"]);

  // -----------------------
  // Storage-Bucket
  // -----------------------
  await ensureBucket();

  console.log("✅ Schema & Bucket sind bereit.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
