import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const generatedAt = new Date().toISOString();

const CADASTRE_URL =
  "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre_WFS/MapServer/0/query";
const WATER_LINE_URL =
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Water_Theme_multiCRS/FeatureServer/5/query";
const WATER_AREA_URL =
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Water_Theme_multiCRS/FeatureServer/6/query";
const CARBON_IDENTIFY_URL =
  "https://asris.csiro.au/arcgis/rest/services/TERN/SOC_ACLEP_AU_TRN_N/MapServer/identify";
const SOIL_IDENTIFY_URL =
  "https://asris.csiro.au/arcgis/rest/services/TERN/CLY_ACLEP_AU_TRN_N/MapServer/identify";
const VEGETATION_IDENTIFY_URL =
  "https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer/identify";
const BIODIVERSITY_URL =
  "https://gis.environment.gov.au/gispub/rest/services/species/species_discovery_minimap/MapServer/1/query";
const DEA_WMS_URL = "https://ows.dea.ga.gov.au/";

const config = JSON.parse(
  await fs.readFile(path.join(dataDir, "nsw-sample-config.json"), "utf8")
);

const cadastreCollection = await fetchCadastreSamples(config);
await fs.writeFile(
  path.join(dataDir, "nsw-sample-parcels.geojson"),
  `${JSON.stringify(cadastreCollection, null, 2)}\n`,
  "utf8"
);

const enrichedCollection = {
  type: "FeatureCollection",
  metadata: {
    jurisdiction: config.jurisdiction,
    region_label: config.region_label,
    generated_at: generatedAt,
    generated_by: "scripts/build-nsw-demo.mjs",
    notes:
      "Parcel geometries are live NSW cadastre samples chosen from statewide anchor points. Carbon, soil, vegetation and NDWI are point samples at each anchor; water and biodiversity are parcel-envelope screening overlays. EII output is a local-condition proxy inspired by the published Local Modulation concept, not the official baseline EII."
  },
  features: await Promise.all(cadastreCollection.features.map((feature) => enrichFeature(feature)))
};

await fs.writeFile(
  path.join(dataDir, "nsw-sample-properties.enriched.geojson"),
  `${JSON.stringify(enrichedCollection, null, 2)}\n`,
  "utf8"
);

console.log(
  `Built NSW demo for ${enrichedCollection.features.length} sample plots at ${enrichedCollection.metadata.generated_at}`
);

async function fetchCadastreSamples(sampleConfig) {
  const features = await Promise.all(
    sampleConfig.sample_plots.map(async (plot, index) => {
      const pointAttributes = await fetchCadastreParcelAtPoint(plot.anchor_point);
      const feature = await fetchCadastreGeometryByLotId(pointAttributes.lotidstring);
      const areaSqm =
        numeric(feature.properties.planlotarea) || approximateAreaSqm(feature.geometry);

      return {
        ...feature,
        properties: {
          sample_id: plot.sample_id,
          property_id: pointAttributes.lotidstring,
          property_name: plot.display_name,
          region: plot.region,
          lotidstring: pointAttributes.lotidstring,
          lotnumber: feature.properties.lotnumber,
          planlabel: feature.properties.planlabel,
          registry_reference: "NSW Spatial Services Cadastre",
          jurisdiction: sampleConfig.jurisdiction,
          region_label: sampleConfig.region_label,
          source_objectid: feature.properties.objectid,
          anchor_point: plot.anchor_point,
          intended_land_type: plot.intended_land_type,
          tenure_type: plot.tenure_type || null,
          land_use: plot.land_use || null,
          land_use_type: plot.land_use_type || null,
          planning_zone: plot.planning_zone || null,
          permitted_uses: plot.permitted_uses || null,
          area_sqm: round(areaSqm, 2),
          area_ha: round(areaSqm / 10000, 2),
          summary: `Live NSW cadastral sample ${index + 1} in ${plot.region}, anchored to a ${plot.intended_land_type.toLowerCase()} setting.`
        }
      };
    })
  );

  return {
    type: "FeatureCollection",
    metadata: {
      jurisdiction: sampleConfig.jurisdiction,
      region_label: sampleConfig.region_label,
      source: CADASTRE_URL,
      sample_strategy: "Anchor-point parcel lookup across NSW"
    },
    features
  };
}

async function fetchCadastreParcelAtPoint(point) {
  const response = await fetchJson(CADASTRE_URL, {
    geometry: `${point[0]},${point[1]}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields:
      "objectid,lotnumber,planlabel,lotidstring,planlotarea,planlotareaunits",
    returnGeometry: "false",
    f: "pjson"
  });

  const attributes = selectLargestRecord((response.features || []).map((item) => item.attributes));
  if (!attributes?.lotidstring) {
    throw new Error(`No cadastre parcel returned for point ${point.join(",")}`);
  }

  return attributes;
}

async function fetchCadastreGeometryByLotId(lotId) {
  const response = await fetchJson(CADASTRE_URL, {
    where: `lotidstring='${lotId}'`,
    outFields:
      "objectid,lotnumber,planlabel,lotidstring,planlotarea,planlotareaunits",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson"
  });

  const feature = selectLargestFeature(response.features || []);
  if (!feature) {
    throw new Error(`No cadastre geometry returned for ${lotId}`);
  }

  return feature;
}

async function enrichFeature(feature) {
  const anchorPoint = feature.properties.anchor_point || geometryToCentroid(feature.geometry);
  const identifyExtent = pointToExtent(anchorPoint, 0.05);
  const parcelEnvelope = geometryToEnvelope(feature.geometry);

  const [
    carbon,
    soil,
    vegetation,
    ndwi,
    waterLineCount,
    waterAreaCount,
    waterPreview,
    biodiversityCount,
    biodiversityPreview
  ] = await Promise.all([
    sampleIdentify(CARBON_IDENTIFY_URL, 1, anchorPoint, identifyExtent),
    sampleIdentify(SOIL_IDENTIFY_URL, 1, anchorPoint, identifyExtent),
    sampleIdentify(VEGETATION_IDENTIFY_URL, 0, anchorPoint, identifyExtent),
    fetchDeaNdwi(anchorPoint, identifyExtent),
    fetchCount(WATER_LINE_URL, parcelEnvelope),
    fetchCount(WATER_AREA_URL, parcelEnvelope),
    fetchPreview(WATER_LINE_URL, parcelEnvelope, "hydroname,perenniality,hydrotype"),
    fetchCount(BIODIVERSITY_URL, parcelEnvelope),
    fetchPreview(
      BIODIVERSITY_URL,
      parcelEnvelope,
      "SCIENTIFIC_NAME,VERNACULAR_NAME,PRESENCE_CATEGORY",
      12
    )
  ]);

  const carbonValue = numeric(carbon?.["Classify.Pixel Value"]);
  const soilValue = numeric(soil?.["Classify.Pixel Value"]);
  const vegetationGroup = vegetation?.["Raster.MVG_NAME"] || "Unknown/no data";
  const vegetationDescription =
    vegetation?.["Raster.MVG_COMMON_DESC"] || "No vegetation class returned";
  const vegetationBand = floraBandFromMvgName(vegetationGroup);
  const vegetationNaturalness = vegetationNaturalnessFromMvgName(vegetationGroup);
  const ndwiValue = numeric(ndwi?.value);
  const ndwiYear = ndwi?.time ? new Date(ndwi.time).getUTCFullYear() : null;
  const hydroSummary = summarizeHydrology(waterPreview);
  const speciesExamples = uniqueByText(
    biodiversityPreview.map((item) =>
      item.VERNACULAR_NAME
        ? `${item.VERNACULAR_NAME} (${item.SCIENTIFIC_NAME})`
        : item.SCIENTIFIC_NAME
    )
  ).slice(0, 4);

  const areaHa = feature.properties.area_ha || 1;
  const carbonScore = clamp(Math.round((carbonValue || 0) * 25), 0, 100);
  const soilScore = clamp(Math.round(100 - Math.abs((soilValue || 0) - 25) * 3), 0, 100);
  const ndwiScore = clamp(Math.round(((ndwiValue || -1) + 1) * 50), 0, 100);
  // Water score is density-normalised by parcel area (floor at 100 ha to avoid inflating tiny parcels).
  // Raw feature counts are not comparable across parcels of very different sizes.
  const waterDensityDenominator = Math.max(areaHa / 100, 1);
  const waterScore = clamp(Math.round((waterAreaCount * 35 + waterLineCount * 8) / waterDensityDenominator), 0, 100);
  const biodiversityScore = clamp(biodiversityCount * 4, 0, 100);

  const localConditionIndex = round(
    average([
      carbonScore / 100,
      waterScore / 100,
      biodiversityScore / 100,
      vegetationNaturalness
    ]),
    2
  );
  const eiiLocalModulationDelta = round((localConditionIndex - 0.5) * 0.1, 3);

  return {
    ...feature,
    properties: {
      ...feature.properties,
      vegetation_band: vegetationBand,
      vegetation_group: vegetationGroup,
      vegetation_detail: `Dominant NVIS vegetation at the sample anchor point: ${vegetationGroup}. ${capitalizeSentence(
        vegetationDescription
      )}.`,
      carbon_score: carbonScore,
      carbon_band: screeningBandFromScore(carbonScore),
      carbon_value_display: carbonValue
        ? `${carbonValue.toFixed(2)}% topsoil organic carbon`
        : "No carbon value returned",
      carbon_detail: carbonValue
        ? "Sampled from the public ASRIS or TERN soil organic carbon raster at the sample anchor point."
        : "The public carbon service did not return a pixel value at the sample anchor point.",
      soil_score: soilScore,
      soil_band: screeningBandFromScore(soilScore),
      soil_value_display: soilValue
        ? `${soilValue.toFixed(2)}% clay content`
        : "No soil value returned",
      soil_detail: soilValue
        ? "Sampled from the public ASRIS or TERN clay-content raster at the sample anchor point."
        : "The public soil service did not return a pixel value at the sample anchor point.",
      ndwi_score: ndwiScore,
      ndwi_band: ndwiBandFromValue(ndwiValue),
      ndwi_value_display:
        ndwiValue !== null
          ? `${ndwiValue.toFixed(2)} annual GeoMAD NDWI${ndwiYear ? ` (${ndwiYear})` : ""}`
          : "No NDWI value returned",
      ndwi_detail:
        ndwiValue !== null
          ? "Surface moisture index sampled from the DEA GeoMAD annual composite at the anchor point. Measures spectral wetness of the land surface — not the presence of watercourses. Rural NSW land typically reads −0.3 to −0.7; irrigated crops and wetlands read closer to 0."
          : "The DEA NDWI service did not return a value at the sample anchor point.",
      water_score: waterScore,
      water_band: screeningBandFromScore(waterScore),
      water_value_display: `${waterAreaCount} hydro areas, ${waterLineCount} hydro lines (${round((waterAreaCount * 35 + waterLineCount * 8) / areaHa * 100, 1)} weighted features per 100 ha)`,
      water_detail:
        (hydroSummary ? hydroSummary + " " : "") +
        `Score is density-normalised by parcel area (${round(areaHa, 0)} ha) so that larger parcels are not rewarded simply for containing more mapped features.`,
      biodiversity_score: biodiversityScore,
      biodiversity_band: screeningBandFromScore(biodiversityScore),
      biodiversity_value_display: `${biodiversityCount} EPBC screening records`,
      biodiversity_detail: speciesExamples.length
        ? `Examples from the public species significance service: ${speciesExamples.join(", ")}.`
        : "Counted from the public species significance service using the parcel envelope.",
      eii_local_condition_index: localConditionIndex,
      eii_local_condition_band: localConditionBandFromIndex(localConditionIndex),
      eii_local_condition_display: `LCI ${localConditionIndex.toFixed(2)} | approx ${formatSigned(
        eiiLocalModulationDelta,
        2
      )} EII`,
      eii_local_condition_detail:
        "Prototype local-condition feature aligned to the EII Local Modulation concept. It combines local carbon, water, biodiversity and vegetation-naturalness proxies from this parcel. The official baseline EII is not included here because the published workflow uses an authenticated Earth Engine pipeline.",
      source_generated_at: generatedAt
    }
  };
}

async function sampleIdentify(url, layerId, point, extent) {
  const response = await fetchJson(url, {
    geometry: `${point[0]},${point[1]}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers: `all:${layerId}`,
    tolerance: "1",
    mapExtent: extent.join(","),
    imageDisplay: "1200,800,96",
    returnGeometry: "false",
    f: "pjson"
  });

  return response.results?.[0]?.attributes || null;
}

async function fetchCount(url, envelope) {
  const response = await fetchJson(url, {
    where: "1=1",
    geometry: envelope.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    returnCountOnly: "true",
    f: "pjson"
  });

  return Number(response.count || 0);
}

async function fetchPreview(url, envelope, outFields, limit = 5) {
  const response = await fetchJson(url, {
    where: "1=1",
    geometry: envelope.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: "false",
    resultRecordCount: String(limit),
    f: "pjson"
  });

  return (response.features || []).map((item) => item.attributes);
}

async function fetchDeaNdwi(point, extent) {
  const response = await fetchJson(DEA_WMS_URL, {
    service: "WMS",
    version: "1.3.0",
    request: "GetFeatureInfo",
    layers: "ga_ls8cls9c_gm_cyear_3",
    query_layers: "ga_ls8cls9c_gm_cyear_3",
    styles: "ndwi",
    crs: "EPSG:4326",
    bbox: toWmsBbox4326(extent),
    width: "101",
    height: "101",
    i: "50",
    j: "50",
    info_format: "application/json"
  });

  const latest = response.features?.[0]?.properties?.data?.[0];
  if (!latest) {
    return null;
  }

  return {
    time: latest.time,
    value: latest.band_derived?.ndwi
  };
}

async function fetchJson(url, params, attempts = 3) {
  const requestUrl = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    requestUrl.searchParams.set(key, value);
  });

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(requestUrl, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      const text = await response.text();
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(400 * attempt);
      }
    }
  }

  throw new Error(`Unable to fetch ${requestUrl}: ${lastError?.message || "Unknown error"}`);
}

function pointToExtent(point, halfSizeDegrees = 0.05) {
  return [
    point[0] - halfSizeDegrees,
    point[1] - halfSizeDegrees,
    point[0] + halfSizeDegrees,
    point[1] + halfSizeDegrees
  ];
}

function toWmsBbox4326(envelope) {
  return [envelope[1], envelope[0], envelope[3], envelope[2]].join(",");
}

function selectLargestRecord(records) {
  return records.reduce((currentBest, record) => {
    if (!currentBest) {
      return record;
    }

    const bestArea = numeric(currentBest.planlotarea) || -1;
    const candidateArea = numeric(record.planlotarea) || -1;
    return candidateArea > bestArea ? record : currentBest;
  }, null);
}

function selectLargestFeature(features) {
  return features.reduce((currentBest, feature) => {
    if (!currentBest) {
      return feature;
    }

    const bestArea =
      numeric(currentBest.properties.planlotarea) || approximateAreaSqm(currentBest.geometry);
    const candidateArea =
      numeric(feature.properties.planlotarea) || approximateAreaSqm(feature.geometry);
    return candidateArea > bestArea ? feature : currentBest;
  }, null);
}

function geometryToEnvelope(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of flattenGeometry(geometry)) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return [minX, minY, maxX, maxY];
}

function geometryToCentroid(geometry) {
  const envelope = geometryToEnvelope(geometry);
  return [(envelope[0] + envelope[2]) / 2, (envelope[1] + envelope[3]) / 2];
}

function flattenGeometry(geometry) {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat();
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat(2);
  }

  throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

function approximateAreaSqm(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return round(polygons.reduce((sum, polygon) => sum + polygonAreaSqm(polygon), 0), 2);
}

function polygonAreaSqm(rings) {
  if (!rings.length) {
    return 0;
  }

  const [outer, ...holes] = rings;
  return Math.abs(ringAreaSqm(outer)) - holes.reduce((sum, ring) => sum + Math.abs(ringAreaSqm(ring)), 0);
}

function ringAreaSqm(ring) {
  const avgLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.cos((avgLat * Math.PI) / 180) * metersPerDegreeLat;

  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    area += x1 * metersPerDegreeLon * (y2 * metersPerDegreeLat);
    area -= x2 * metersPerDegreeLon * (y1 * metersPerDegreeLat);
  }

  return area / 2;
}

function screeningBandFromScore(score) {
  if (score >= 80) {
    return "Very high";
  }
  if (score >= 60) {
    return "High";
  }
  if (score >= 40) {
    return "Moderate";
  }
  if (score >= 20) {
    return "Low";
  }
  return "Very low";
}

function floraBandFromMvgName(name) {
  const normalized = (name || "").toLowerCase();

  if (normalized.includes("cleared") || normalized.includes("regrowth")) {
    return "Modified or cleared";
  }
  if (normalized.includes("rainforest") || normalized.includes("forest")) {
    return "Forest";
  }
  if (normalized.includes("woodland")) {
    return "Woodland";
  }
  if (
    normalized.includes("grassland") ||
    normalized.includes("herbland") ||
    normalized.includes("sedgeland") ||
    normalized.includes("rushland")
  ) {
    return "Grassland or herbland";
  }
  if (normalized.includes("shrubland") || normalized.includes("heath")) {
    return "Shrubland or heath";
  }
  if (
    normalized.includes("aquatic") ||
    normalized.includes("mangrove") ||
    normalized.includes("estuaries")
  ) {
    return "Wetland or aquatic";
  }
  if (normalized.includes("bare")) {
    return "Bare or sparsely vegetated";
  }

  return "Other native vegetation";
}

function vegetationNaturalnessFromMvgName(name) {
  const normalized = (name || "").toLowerCase();

  if (normalized.includes("cleared")) {
    return 0.2;
  }
  if (normalized.includes("regrowth")) {
    return 0.55;
  }
  if (normalized.includes("unknown") || normalized.includes("unclassified")) {
    return 0.4;
  }
  if (normalized.includes("bare") || normalized.includes("aquatic") || normalized.includes("estuaries")) {
    return 0.35;
  }

  return 0.85;
}

function localConditionBandFromIndex(value) {
  if (value >= 0.8) {
    return "Very strong";
  }
  if (value >= 0.6) {
    return "Strong";
  }
  if (value >= 0.4) {
    return "Mixed";
  }
  if (value >= 0.2) {
    return "Weak";
  }
  return "Very weak";
}

function ndwiBandFromValue(value) {
  // Thresholds calibrated for annual-average GeoMAD NDWI over rural NSW land.
  // Open water reads ~0.0 to +0.8; dry native vegetation typically -0.3 to -0.7.
  // The old thresholds (centred on 0) put all non-irrigated rural land in "Very dry".
  if (value === null) {
    return "No data";
  }
  if (value >= 0.0) {
    return "Very wet";
  }
  if (value >= -0.2) {
    return "Wet";
  }
  if (value >= -0.4) {
    return "Moderate";
  }
  if (value >= -0.6) {
    return "Dry";
  }
  return "Very dry";
}

function summarizeHydrology(preview) {
  if (!preview.length) {
    return "";
  }

  const perennialities = uniqueByText(
    preview.map((item) => perennialityLabel(item.perenniality)).filter(Boolean)
  );
  const hydrotypes = uniqueByText(
    preview.map((item) => hydrotypeLabel(item.hydrotype)).filter(Boolean)
  );

  const phrases = [];
  if (hydrotypes.length) {
    phrases.push(`Hydrology preview includes ${hydrotypes.join(", ")}`);
  }
  if (perennialities.length) {
    phrases.push(`perenniality classes observed: ${perennialities.join(", ")}`);
  }

  return `${phrases.join("; ")}.`;
}

function perennialityLabel(value) {
  const labels = {
    1: "perennial",
    2: "non-perennial",
    3: "unknown perenniality"
  };
  return labels[value] || "";
}

function hydrotypeLabel(value) {
  const labels = {
    1: "watercourse",
    2: "canal",
    3: "drain",
    4: "pipeline"
  };
  return labels[value] || "";
}

function capitalizeSentence(value) {
  if (!value) {
    return "";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function uniqueByText(values) {
  return [...new Set(values.filter(Boolean))];
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatSigned(value, decimals) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}`;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
