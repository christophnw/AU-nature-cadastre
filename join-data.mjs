import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../data");

const properties = JSON.parse(
  await fs.readFile(path.join(dataDir, "properties.geojson"), "utf8")
);
const metrics = JSON.parse(
  await fs.readFile(path.join(dataDir, "natural-capital-metrics.json"), "utf8")
);

const enriched = {
  ...properties,
  features: properties.features.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      ...(metrics[feature.properties.property_id] || {})
    }
  }))
};

await fs.writeFile(
  path.join(dataDir, "properties.enriched.geojson"),
  `${JSON.stringify(enriched, null, 2)}\n`,
  "utf8"
);

console.log(`Joined ${enriched.features.length} properties into properties.enriched.geojson`);
