// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiajdqYW1lcyIsImEiOiJjbXdneHViczIwZGpnMnpwbnV5MWJtdzRkIn0.8fQcU2nLkhD9kHqWME8PFA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v11',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Wait for the map to load before adding data
map.on('load', async () => {
  // 1. Connect the data
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  // 2. Draw it
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route', // must match the addSource ID above
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4,
    },
  });
});