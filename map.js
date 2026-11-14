// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
// Import D3 as an ESM module
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

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

// ---------- Global helpers ----------

// Select the SVG overlay inside the map container
const svg = d3.select('#map').select('svg');

// Convert a station's lon/lat into pixel coordinates on the map
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

// Slider value (minutes since midnight) -> "8:30 AM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// Date -> minutes since midnight (0–1439)
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Trips pre-sorted into one bucket per minute of the day (Step 5.4)
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Get trips within 60 minutes of `minute` using the buckets (handles wrapping past midnight)
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Add arrivals / departures / totalTraffic to each station for a given time filter
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.end_station_id,
  );

  // Update station data with filtered counts
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Departure ratio (0–1) -> one of 3 discrete values for coloring (Step 6.1)
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Stations with no trips in the window would give 0/0 = NaN, so treat them as balanced
function departureRatio(d) {
  return d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic);
}

function tooltipText(d) {
  return `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
}

// Shared style for all bike lane layers (edit once, applies everywhere)
const bikeLaneStyle = {
  'line-color': '#32D400', // bright green
  'line-width': 5,
  'line-opacity': 0.6,
};

// ---------- Everything that needs the map loaded ----------

map.on('load', async () => {
  // Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  let jsonData;
  try {
    // Bluebikes stations
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);

    // Bluebikes trips (Step 4.1): parse dates and sort each trip into minute buckets as it loads
    const trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);

        let startedMinutes = minutesSinceMidnight(trip.started_at);
        departuresByMinute[startedMinutes].push(trip);

        let endedMinutes = minutesSinceMidnight(trip.ended_at);
        arrivalsByMinute[endedMinutes].push(trip);

        return trip;
      },
    );
    console.log('Loaded trips:', trips.length);

    // Stations with traffic counts (Step 4.2 / 5.3)
    const stations = computeStationTraffic(jsonData.data.stations);
    console.log('Stations Array:', stations);

    // Circle AREA proportional to traffic -> square root scale (Step 4.3)
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    // Append circles to the SVG for each station (fill/stroke/opacity are in map.css)
    const circles = svg
      .selectAll('circle')
      .data(stations, (d) => d.short_name) // Use station short_name as the key
      .enter()
      .append('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', departureRatio)
      .each(function (d) {
        // Add <title> for browser tooltips (Step 4.4)
        d3.select(this).append('title').text(tooltipText(d));
      });

    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // ---------- Time slider (Step 5.2) ----------
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    // Recompute traffic for the selected time and resize/recolor circles (Step 5.3)
    function updateScatterPlot(timeFilter) {
      const filteredStations = computeStationTraffic(stations, timeFilter);

      // Bigger circles when filtering, since fewer trips are shown
      timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

      circles
        .data(filteredStations, (d) => d.short_name) // Ensure D3 tracks elements correctly
        .join('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .style('--departure-ratio', departureRatio)
        .select('title') // keep tooltips in sync with the filter
        .text(tooltipText);
    }

    function updateTimeDisplay() {
      let timeFilter = Number(timeSlider.value); // Get slider value

      if (timeFilter === -1) {
        selectedTime.textContent = ''; // Clear time display
        anyTimeLabel.style.display = 'block'; // Show "(any time)"
      } else {
        selectedTime.textContent = formatTime(timeFilter); // Display formatted time
        anyTimeLabel.style.display = 'none'; // Hide "(any time)"
      }

      // Update the map to reflect the selected time
      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();
  } catch (error) {
    console.error('Error loading data:', error); // Handle errors
  }
});
