const map = L.map("map", {
  zoomControl: false
}).setView([-33.36, 149.62], 11);

L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const datasets = await Promise.all([
  fetch("./data/nsw-sample-properties.enriched.geojson").then((response) => response.json()),
  fetch("./data/public-sources.json").then((response) => response.json())
]);

const [properties, publicSources] = datasets;
const propertySelect = document.querySelector("#property-select");
const propertySummary = document.querySelector("#property-summary");
const metricsContainer = document.querySelector("#metrics");
const sourcesContainer = document.querySelector("#sources");
const layerToggles = document.querySelector("#layer-toggles");

const layerPalette = {
  cadastre: "#a96b1f",
  carbon: "#27523b",
  soil: "#8e5f3f",
  ndwi: "#1d8fa3",
  water: "#2c6e91",
  biodiversity: "#7b3f69",
  vegetation: "#4a7c59",
  integrity: "#8a6a2f"
};

const parcelLayer = L.geoJSON(properties, {
  style: () => ({
    color: "#295c46",
    weight: 2,
    fillColor: "#b8d8bd",
    fillOpacity: 0.45
  }),
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    layer.bindPopup(`
      <strong>${p.property_name}</strong><br />
      Property ID: ${p.property_id}<br />
      Region: ${p.region}<br />
      Area: ${p.area_ha} ha<br />
      Vegetation: ${p.vegetation_band}<br />
      Carbon: ${p.carbon_band}<br />
      Soil: ${p.soil_band}<br />
      NDWI: ${p.ndwi_band}<br />
      Water: ${p.water_band}<br />
      Biodiversity: ${p.biodiversity_band}<br />
      EII local condition: ${p.eii_local_condition_band}
    `);
    layer.on("click", () => syncSelection(p.property_id));
  }
}).addTo(map);

map.fitBounds(parcelLayer.getBounds(), { padding: [24, 24] });

const overlayLayers = {};
publicSources.layers.forEach((source) => {
  const color = layerPalette[source.category] || "#555555";
  const layer =
    source.serviceType === "esri-dynamic" && window.L.esri
      ? L.esri.dynamicMapLayer({
          url: source.url,
          layers: source.visibleLayers,
          opacity: 0.45,
          attribution: source.attribution || ""
        })
      : source.tileUrl
        ? L.tileLayer.wms(source.tileUrl, {
            layers: source.layerName,
            styles: source.styles || "",
            format: "image/png",
            transparent: true,
            opacity: 0.45,
            attribution: source.attribution || ""
          })
        : null;

  overlayLayers[source.id] = layer;

  if (layer) {
    const row = document.createElement("label");
    row.className = "toggle";
    row.innerHTML = `
      <input type="checkbox" value="${source.id}" ${source.id === "cadastre-nsw" ? "checked" : ""} />
      <span>
        <strong style="color:${color}">${source.name}</strong>
        <small>${source.description}</small>
      </span>
    `;
    layerToggles.appendChild(row);

    if (source.id === "cadastre-nsw") {
      layer.addTo(map);
    }

    row.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) {
        layer.addTo(map);
      } else {
        map.removeLayer(layer);
      }
    });
  }
});

publicSources.layers.forEach((source) => {
  const entry = document.createElement("div");
  entry.className = "source";
  entry.innerHTML = `
    <strong>${source.name}</strong>
    <small>${source.provider}</small>
    <small>${source.description}</small>
    <a href="${source.referenceUrl}" target="_blank" rel="noreferrer">Source</a>
  `;
  sourcesContainer.appendChild(entry);
});

const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = `
    <div><span style="background:#295c46"></span>Property boundary</div>
    <div><span style="background:${layerPalette.cadastre}"></span>NSW cadastre overlay</div>
    <div><span style="background:${layerPalette.carbon}"></span>Carbon</div>
    <div><span style="background:${layerPalette.soil}"></span>Soil</div>
    <div><span style="background:${layerPalette.ndwi}"></span>NDWI</div>
    <div><span style="background:${layerPalette.water}"></span>Water</div>
    <div><span style="background:${layerPalette.biodiversity}"></span>Biodiversity</div>
    <div><span style="background:${layerPalette.vegetation}"></span>Vegetation</div>
  `;
  return div;
};
legend.addTo(map);

properties.features.forEach((feature) => {
  const option = document.createElement("option");
  option.value = feature.properties.property_id;
  option.textContent = `${feature.properties.property_name} - ${feature.properties.region}`;
  propertySelect.appendChild(option);
});

propertySelect.addEventListener("change", (event) => {
  syncSelection(event.target.value);
});

function syncSelection(propertyId) {
  const feature = properties.features.find((item) => item.properties.property_id === propertyId);
  if (!feature) {
    return;
  }

  propertySelect.value = propertyId;
  renderSummary(feature.properties);
  renderMetrics(feature.properties);

  const bounds = L.geoJSON(feature).getBounds();
  map.fitBounds(bounds, { maxZoom: 14, padding: [48, 48] });

  parcelLayer.eachLayer((layer) => {
    const isSelected = layer.feature.properties.property_id === propertyId;
    layer.setStyle({
      color: isSelected ? "#94743b" : "#295c46",
      weight: isSelected ? 4 : 2,
      fillOpacity: isSelected ? 0.6 : 0.45
    });
    if (isSelected) {
      layer.openPopup();
    }
  });
}

function renderSummary(propertiesForParcel) {
  const generatedAt = properties.metadata?.generated_at
    ? new Date(properties.metadata.generated_at).toLocaleString()
    : "Unknown";

  const p = propertiesForParcel;
  const tenureSection = p.tenure_type ? `
    <div class="tenure-section">
      <strong>Land &amp; Tenure</strong>
      <div class="tenure-table">
        <span class="tenure-label">Tenure</span>
        <span>${p.tenure_type}</span>
        <span class="tenure-label">Land use</span>
        <span>${p.land_use}</span>
        <span class="tenure-label">Use type</span>
        <span>${p.land_use_type}</span>
        <span class="tenure-label">Planning zone</span>
        <span>${p.planning_zone}</span>
        <span class="tenure-label">Permitted uses</span>
        <span>${p.permitted_uses}</span>
      </div>
    </div>
  ` : "";

  propertySummary.innerHTML = `
    <strong>${p.property_name}</strong>
    Property ID: ${p.property_id}<br />
    Jurisdiction: ${p.jurisdiction}<br />
    Region: ${p.region}<br />
    Area: ${p.area_ha} ha<br />
    Vegetation band: ${p.vegetation_band}<br />
    Registry reference: ${p.registry_reference}<br />
    ${tenureSection}
    <small>${p.summary}</small>
    <small>Live sample generated: ${generatedAt}</small>
  `;
}

function renderMetrics(propertiesForParcel) {
  const groups = [
    {
      key: "vegetation",
      label: "Vegetation or Flora Type",
      band: propertiesForParcel.vegetation_band,
      value: propertiesForParcel.vegetation_group,
      detail: propertiesForParcel.vegetation_detail
    },
    {
      key: "carbon",
      label: "Carbon",
      band: propertiesForParcel.carbon_band,
      value: propertiesForParcel.carbon_value_display,
      detail: propertiesForParcel.carbon_detail
    },
    {
      key: "soil",
      label: "Soil",
      band: propertiesForParcel.soil_band,
      value: propertiesForParcel.soil_value_display,
      detail: propertiesForParcel.soil_detail
    },
    {
      key: "ndwi",
      label: "NDWI",
      band: propertiesForParcel.ndwi_band,
      value: propertiesForParcel.ndwi_value_display,
      detail: propertiesForParcel.ndwi_detail
    },
    {
      key: "water",
      label: "Water",
      band: propertiesForParcel.water_band,
      value: propertiesForParcel.water_value_display,
      detail: propertiesForParcel.water_detail
    },
    {
      key: "biodiversity",
      label: "Biodiversity",
      band: propertiesForParcel.biodiversity_band,
      value: propertiesForParcel.biodiversity_value_display,
      detail: propertiesForParcel.biodiversity_detail
    },
    {
      key: "integrity",
      label: "EII Local Condition",
      band: propertiesForParcel.eii_local_condition_band,
      value: propertiesForParcel.eii_local_condition_display,
      detail: propertiesForParcel.eii_local_condition_detail
    }
  ];

  metricsContainer.innerHTML = "";
  groups.forEach((group) => {
    const card = document.createElement("div");
    card.className = `metric ${group.key}`;
    card.innerHTML = `
      <strong>${group.label}</strong>
      <div class="metric-head">
        <span class="band-chip">${group.band}</span>
        <span class="metric-value">${group.value}</span>
      </div>
      <small>${group.detail}</small>
    `;
    metricsContainer.appendChild(card);
  });
}

syncSelection(properties.features[0].properties.property_id);
