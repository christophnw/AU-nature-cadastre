# Nature Cadastre Prototype

This is a lightweight prototype that shows how you can:

1. represent parcel or cadastral boundaries as unique property IDs
2. join public natural capital metrics to each property
3. render the result in a simple map UI with layer controls

## What is included

- `index.html`: static front-end for map and parcel details
- `src/app.js`: Leaflet-based UI logic
- `data/properties.geojson`: example parcel boundaries
- `data/natural-capital-metrics.json`: example joined natural capital indicators
- `data/nsw-sample-config.json`: NSW statewide anchor points used to select live cadastre parcels
- `data/nsw-sample-parcels.geojson`: live cadastre sample plots fetched from NSW Spatial Services
- `data/nsw-sample-properties.enriched.geojson`: live NSW sample plots enriched with public natural capital screening data
- `data/public-sources.json`: official source references and map layer config for carbon, soil, water, biodiversity, vegetation and integrity context
- the map now also includes a full NSW cadastre overlay toggle sourced directly from the NSW cadastre display service
- `scripts/join-data.mjs`: simple join step that enriches each property by `property_id`
- `scripts/build-nsw-demo.mjs`: live NSW fetch and enrichment pipeline

## Run locally

From this folder:

```bash
cd "/Users/christoph/Documents/01 Work/01 Roles/Landbanking/Product/Cadastre/prototype"
python3 -m http.server 4173
```

Then open:

- [http://localhost:4173](http://localhost:4173)

## Build the live NSW demo data

From this folder:

```bash
cd "/Users/christoph/Documents/01 Work/01 Roles/Landbanking/Product/Cadastre/prototype"
node ./scripts/build-nsw-demo.mjs
```

The script will:

- fetch live NSW cadastre sample plots from statewide anchor points
- classify each parcel with a high-level vegetation or flora band from NVIS
- sample public carbon and soil rasters at each sample anchor point
- sample DEA GeoMAD NDWI at each sample anchor point
- count public water and biodiversity records against each parcel envelope
- derive screening bands for the natural capital indicators
- derive an EII-style local condition feature from local proxy KPIs
- write the enriched GeoJSON consumed by the UI

## How the matching works

Right now the prototype uses a simple `property_id` join:

- parcel polygons live in `data/properties.geojson`
- natural capital scores live in `data/natural-capital-metrics.json`
- `scripts/join-data.mjs` merges them into `data/properties.enriched.geojson`

For the NSW live flow, the parcel identifier is the cadastre `lotidstring`, and enrichment is done directly from public services in `scripts/build-nsw-demo.mjs`.

To rebuild the joined file:

```bash
cd "/Users/christoph/Documents/01 Work/01 Roles/Landbanking/Product/Cadastre/prototype"
node ./scripts/join-data.mjs
```

## Live NSW sources used here

- NSW Cadastre: `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre_WFS/MapServer/0`
- NSW Cadastre display service: `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer`
- NSW Water Theme: `https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Water_Theme_multiCRS/MapServer`
- ASRIS Soil Organic Carbon: `https://asris.csiro.au/arcgis/rest/services/TERN/SOC_ACLEP_AU_TRN_N/MapServer`
- ASRIS Clay Content: `https://asris.csiro.au/arcgis/rest/services/TERN/CLY_ACLEP_AU_TRN_N/MapServer`
- DCCEEW species screening: `https://gis.environment.gov.au/gispub/rest/services/species/species_discovery_minimap/MapServer`
- NVIS extant major vegetation groups: `https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer`
- DEA OGC services and GeoMAD NDWI: `https://ows.dea.ga.gov.au/`
- EII documentation: `https://landler-io.github.io/ecosystem-integrity-index/`

## Important caveat on the live screening metrics

This NSW demo uses a pragmatic screening workflow:

- cadastre geometry is live and real
- carbon, soil, vegetation and NDWI are anchor-point samples from public rasters and map services
- water and biodiversity use parcel-envelope intersection counts for a simple first-pass screen
- the EII feature is a local-condition proxy inspired by the published Local Modulation concept, not the official baseline EII

That makes it useful for product prototyping, but not yet production-grade spatial analytics. A stronger next version would use exact polygon intersections, zonal statistics and authenticated access to the official EII baseline workflow.

## Important limitation

This prototype is a screening UI, not a legal cadastral or valuation product. Any production workflow should verify:

- state-by-state licensing and permitted use of parcel boundaries
- CORS and uptime of public map services
- spatial accuracy, projection handling and parcel refresh cadence
