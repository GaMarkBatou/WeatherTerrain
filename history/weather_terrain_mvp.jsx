import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  AlertTriangle,
  Cloud,
  CloudFog,
  CloudRain,
  CloudSnow,
  Crosshair,
  Layers,
  Loader2,
  MapPin,
  Mountain,
  Sun,
  Thermometer,
  Wind,
} from "lucide-react";

// Optional: add a real MapTiler key here to enable outdoor tiles + 3D terrain.
// Without a key, the app uses MapLibre's public demo basemap and disables terrain instead of throwing 403 errors.
const MAPTILER_KEY = "aX0oCOi0xeZikeidagYz";

const DEFAULT_CENTER = [19.0402, 47.4979]; // Budapest [lng, lat]
const DEFAULT_ZOOM = 8;
const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";

function hasValidMapTilerKey(key) {
  return Boolean(key && key.trim() && key !== "REPLACE_WITH_YOUR_MAPTILER_KEY");
}

function weatherLabel(code) {
  const groups = [
    [[0], "Derült", Sun],
    [[1, 2], "Többnyire napos", Sun],
    [[3], "Felhős", Cloud],
    [[45, 48], "Ködös", CloudFog],
    [[51, 53, 55, 56, 57], "Szitálás", CloudRain],
    [[61, 63, 65, 66, 67, 80, 81, 82], "Esős", CloudRain],
    [[71, 73, 75, 77, 85, 86], "Havas", CloudSnow],
    [[95, 96, 99], "Zivatar", CloudRain],
  ];

  for (const [codes, label, Icon] of groups) {
    if (codes.includes(code)) return { label, Icon };
  }
  return { label: "Ismeretlen", Icon: Cloud };
}

function round(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return Number(value).toFixed(decimals);
}

function makeOpenMeteoUrl(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "rain",
      "snowfall",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
      "wind_direction_10m",
    ].join(","),
    hourly: [
      "temperature_2m",
      "precipitation_probability",
      "precipitation",
      "snowfall",
      "cloud_cover",
      "visibility",
      "wind_speed_10m",
    ].join(","),
    forecast_days: "2",
    timezone: "auto",
  });

  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function getRisk(weather) {
  if (!weather?.current) return { label: "Nincs adat", score: 0 };

  const c = weather.current;
  let score = 0;
  if ((c.wind_speed_10m ?? 0) >= 45) score += 3;
  else if ((c.wind_speed_10m ?? 0) >= 25) score += 1;
  if ((c.precipitation ?? 0) >= 5) score += 3;
  else if ((c.precipitation ?? 0) > 0) score += 1;
  if ((c.snowfall ?? 0) > 0) score += 2;
  if ((c.temperature_2m ?? 20) <= 0) score += 1;
  if ((c.weather_code ?? 0) === 45 || (c.weather_code ?? 0) === 48) score += 2;

  if (score >= 5) return { label: "Magas", score };
  if (score >= 2) return { label: "Közepes", score };
  return { label: "Alacsony", score };
}

function buildMapStyle(mapTilerKey) {
  const hasKey = hasValidMapTilerKey(mapTilerKey);

  if (!hasKey) {
    return {
      style: "https://demotiles.maplibre.org/style.json",
      terrainAvailable: false,
    };
  }

  return {
    terrainAvailable: true,
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        base: {
          type: "raster",
          tiles: [`https://api.maptiler.com/maps/outdoor-v2/{z}/{x}/{y}.png?key=${mapTilerKey}`],
          tileSize: 256,
          attribution: "© MapTiler © OpenStreetMap contributors",
        },
        terrain: {
          type: "raster-dem",
          tiles: [`https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${mapTilerKey}`],
          tileSize: 256,
          encoding: "mapbox",
          attribution: "© MapTiler",
        },
      },
      layers: [
        {
          id: "base",
          type: "raster",
          source: "base",
        },
        {
          id: "hillshade",
          type: "hillshade",
          source: "terrain",
          paint: {
            "hillshade-shadow-color": "#4b5563",
            "hillshade-highlight-color": "#f9fafb",
            "hillshade-accent-color": "#6b7280",
          },
        },
      ],
    },
  };
}

function runSelfTests() {
  console.assert(hasValidMapTilerKey("") === false, "Empty MapTiler key should be invalid");
  console.assert(
    hasValidMapTilerKey("REPLACE_WITH_YOUR_MAPTILER_KEY") === false,
    "Placeholder MapTiler key should be invalid",
  );
  console.assert(hasValidMapTilerKey("abc123") === true, "Non-empty non-placeholder MapTiler key should be valid");
  console.assert(buildMapStyle("").terrainAvailable === false, "Terrain should be disabled without MapTiler key");
  console.assert(buildMapStyle("abc123").terrainAvailable === true, "Terrain should be enabled with MapTiler key");
  console.assert(weatherLabel(45).label === "Ködös", "Weather code 45 should be foggy");
  console.assert(weatherLabel(71).label === "Havas", "Weather code 71 should be snowy");
  console.assert(round(null) === "–", "Null values should render as dash");
}

if (typeof window !== "undefined") {
  runSelfTests();
}

export default function WeatherTerrainMvp() {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const terrainAvailableRef = useRef(hasValidMapTilerKey(MAPTILER_KEY));
  const [selectedPoint, setSelectedPoint] = useState({ lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1] });
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mapWarning, setMapWarning] = useState(
    hasValidMapTilerKey(MAPTILER_KEY)
      ? ""
      : "MapTiler kulcs nincs megadva, ezért az MVP demo alaptérképpel fut, 3D terrain nélkül.",
  );
  const [radarEnabled, setRadarEnabled] = useState(false);
  const [radarFrame, setRadarFrame] = useState(null);
  const [terrainExaggeration, setTerrainExaggeration] = useState(1.5);

  const currentStatus = useMemo(() => {
    const code = weather?.current?.weather_code;
    return weatherLabel(code);
  }, [weather]);

  const outdoorRisk = useMemo(() => getRisk(weather), [weather]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;

    const { style, terrainAvailable } = buildMapStyle(MAPTILER_KEY);
    terrainAvailableRef.current = terrainAvailable;

    const map = new maplibregl.Map({
      container: mapNode.current,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: terrainAvailable ? 60 : 0,
      bearing: terrainAvailable ? -20 : 0,
      antialias: true,
      style,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));

    map.on("load", () => {
      if (terrainAvailable && map.getSource("terrain")) {
        map.setTerrain({ source: "terrain", exaggeration: terrainExaggeration });
        map.setSky({
          "sky-color": "#dbeafe",
          "sky-horizon-blend": 0.35,
          "horizon-color": "#f8fafc",
          "horizon-fog-blend": 0.5,
          "fog-color": "#e5e7eb",
          "fog-ground-blend": 0.6,
        });
      }
    });

    map.on("error", (event) => {
      const message = event?.error?.message || "Térképcsempe betöltési hiba.";
      if (message.includes("403") || message.includes("401")) {
        setMapWarning(
          "A térképszolgáltató elutasította a tile kérést. Ellenőrizd a MapTiler kulcsot, vagy hagyd üresen a demo alaptérképhez.",
        );
      }
    });

    map.on("click", (event) => {
      setSelectedPoint({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    });

    mapRef.current = map;

    return () => {
      if (markerRef.current) markerRef.current.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !terrainAvailableRef.current || !map.getSource("terrain")) return;
    map.setTerrain({ source: "terrain", exaggeration: terrainExaggeration });
  }, [terrainExaggeration]);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchWeather() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(makeOpenMeteoUrl(selectedPoint.lat, selectedPoint.lng), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Open-Meteo hiba: ${response.status}`);
        const data = await response.json();
        setWeather(data);
      } catch (err) {
        if (err.name !== "AbortError") setError(err.message || "Nem sikerült lekérni az időjárást.");
      } finally {
        setLoading(false);
      }
    }

    fetchWeather();
    return () => controller.abort();
  }, [selectedPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (markerRef.current) markerRef.current.remove();

    const el = document.createElement("div");
    el.className = "weather-marker";
    el.innerHTML = `<div style="width: 18px; height: 18px; border-radius: 999px; background: white; border: 3px solid #0f172a; box-shadow: 0 10px 25px rgba(0,0,0,.25);"></div>`;

    markerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([selectedPoint.lng, selectedPoint.lat])
      .addTo(map);
  }, [selectedPoint]);

  useEffect(() => {
    async function fetchRadarMetadata() {
      try {
        const response = await fetch(RAINVIEWER_API);
        if (!response.ok) throw new Error("RainViewer metadata error");
        const data = await response.json();
        const frames = data?.radar?.past || [];
        setRadarFrame(frames[frames.length - 1] || null);
      } catch {
        setRadarFrame(null);
      }
    }

    fetchRadarMetadata();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !radarFrame) return;

    const sourceId = "rainviewer-radar";
    const layerId = "rainviewer-radar-layer";
    const tileUrl = `${radarFrame.path}/256/{z}/{x}/{y}/2/1_1.png`;
    const fullTileUrl = `https://tilecache.rainviewer.com${tileUrl}`;

    if (radarEnabled) {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: "raster",
          tiles: [fullTileUrl],
          tileSize: 256,
          attribution: "RainViewer",
        });
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: "raster",
          source: sourceId,
          paint: {
            "raster-opacity": 0.62,
          },
        });
      }
    } else {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  }, [radarEnabled, radarFrame]);

  const CurrentIcon = currentStatus.Icon;
  const c = weather?.current;
  const terrainAvailable = terrainAvailableRef.current;

  function flyToSelected() {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [selectedPoint.lng, selectedPoint.lat],
      zoom: Math.max(map.getZoom(), 10),
      pitch: terrainAvailable ? 65 : 0,
      bearing: terrainAvailable ? -25 : 0,
    });
  }

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-900">
      <div ref={mapNode} className="absolute inset-0" />

      <div className="absolute left-4 top-4 max-w-md rounded-2xl bg-white/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <Mountain className="h-4 w-4" /> Weather Terrain MVP
            </div>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">Domborzat + aktuális időjárás</h1>
            <p className="mt-1 text-sm text-slate-600">Kattints a térképre: a pont időjárása Open-Meteo-ból frissül.</p>
          </div>
          <div className="rounded-2xl bg-slate-100 p-3">
            {loading ? <Loader2 className="h-7 w-7 animate-spin" /> : <CurrentIcon className="h-7 w-7" />}
          </div>
        </div>

        {mapWarning && (
          <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{mapWarning}</span>
          </div>
        )}

        {error && <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Metric icon={<Thermometer className="h-4 w-4" />} label="Hőmérséklet" value={`${round(c?.temperature_2m)} °C`} />
          <Metric icon={<Thermometer className="h-4 w-4" />} label="Hőérzet" value={`${round(c?.apparent_temperature)} °C`} />
          <Metric icon={<Cloud className="h-4 w-4" />} label="Felhőzet" value={`${round(c?.cloud_cover, 0)} %`} />
          <Metric icon={<CloudRain className="h-4 w-4" />} label="Csapadék" value={`${round(c?.precipitation)} mm`} />
          <Metric icon={<CloudSnow className="h-4 w-4" />} label="Hó" value={`${round(c?.snowfall)} cm`} />
          <Metric icon={<Wind className="h-4 w-4" />} label="Szél" value={`${round(c?.wind_speed_10m)} km/h`} />
        </div>

        <div className="mt-4 rounded-2xl bg-slate-100 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-950">Állapot: {currentStatus.label}</div>
              <div className="text-sm text-slate-600">Outdoor kockázat: {outdoorRisk.label}</div>
            </div>
            <button onClick={flyToSelected} className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800">
              Ugrás pontra
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Layers className="h-4 w-4" /> Radar overlay
            </div>
            <button
              onClick={() => setRadarEnabled((value) => !value)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${radarEnabled ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {radarEnabled ? "Bekapcsolva" : "Kikapcsolva"}
            </button>
          </div>

          <div className={`rounded-2xl border border-slate-200 p-3 ${terrainAvailable ? "" : "opacity-60"}`}>
            <div className="mb-2 flex items-center justify-between text-sm font-medium">
              <span>Domborzat kiemelés</span>
              <span>{terrainAvailable ? `${terrainExaggeration.toFixed(1)}×` : "kulcs kell hozzá"}</span>
            </div>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={terrainExaggeration}
              onChange={(e) => setTerrainExaggeration(Number(e.target.value))}
              disabled={!terrainAvailable}
              className="w-full"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-slate-950 p-3 text-xs text-white">
          <MapPin className="h-4 w-4 shrink-0" />
          <span>
            {selectedPoint.lat.toFixed(5)}, {selectedPoint.lng.toFixed(5)}
          </span>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 rounded-2xl bg-white/95 p-3 text-xs text-slate-600 shadow-xl backdrop-blur">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4" />
          Tipp: valódi 3D domborzathoz adj meg MapTiler kulcsot a fájl tetején.
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon} {label}
      </div>
      <div className="mt-1 text-lg font-bold text-slate-950">{value}</div>
    </div>
  );
}
