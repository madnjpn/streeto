/* ══════════════════════════════════════════════════════════════════
   STREETO — map style
   A deliberately minimal dark basemap: roads, road names, water and
   the building footprints, extruded into 3D. No satellite imagery, no
   landuse colours, no POI clutter - just the streets.

   Tiles come from OpenFreeMap (OpenMapTiles schema, free, no key).
   ══════════════════════════════════════════════════════════════════ */

const TILE_SOURCE = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** Roads, grouped by how important they are. */
const ROADS = {
  major: ['motorway', 'trunk', 'primary'],
  medium: ['secondary', 'tertiary'],
  minor: ['minor', 'service'],
  path: ['path', 'track', 'pedestrian', 'footway', 'cycleway', 'steps', 'bridleway'],
};

/** Colours taken from the app's dark palette. */
const ROAD_COLOURS = {
  major: { fill: '#3b4a63', casing: '#151a23' },
  medium: { fill: '#2c3547', casing: '#131821' },
  minor: { fill: '#222a37', casing: '#10151d' },
  path: { fill: '#1b212c', casing: '#0e1219' },
};

/** A filter that keeps only the listed road classes. */
const classes = (list) => ['in', ['get', 'class'], ['literal', list]];

/** Width that grows with the zoom level. */
const width = (stops) => ['interpolate', ['exponential', 1.4], ['zoom'], ...stops];

const roadLayers = () => {
  const layers = [];
  // Casing first, so every road sits on a darker outline.
  for (const [group, list] of Object.entries(ROADS)) {
    if (group === 'path') continue;
    layers.push({
      id: `road-casing-${group}`,
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: classes(list),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROAD_COLOURS[group].casing,
        'line-width': width(
          group === 'major' ? [8, 3, 14, 9, 18, 20] : group === 'medium' ? [10, 2.5, 16, 8, 18, 16] : [12, 1.6, 18, 6],
        ),
      },
    });
  }
  for (const [group, list] of Object.entries(ROADS)) {
    if (group === 'path') continue;
    layers.push({
      id: `road-${group}`,
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: classes(list),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROAD_COLOURS[group].fill,
        'line-width': width(
          group === 'major' ? [8, 1.6, 14, 7, 18, 18] : group === 'medium' ? [10, 1.2, 16, 6, 18, 14] : [12, 0.8, 18, 4.5],
        ),
      },
    });
  }
  // Paths and tracks are dashed and thin.
  layers.push({
    id: 'road-path',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    filter: classes(ROADS.path),
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': ROAD_COLOURS.path.fill,
      'line-width': width([13, 0.8, 18, 2.4]),
      'line-dasharray': [2, 2.5],
    },
  });
  return layers;
};

export const MAP_STYLE = {
  version: 8,
  name: 'STREETO dark',
  glyphs: GLYPHS,
  sources: {
    openmaptiles: { type: 'vector', url: TILE_SOURCE },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#080a0e' } },

    // Water - just a hint of it.
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#0b1520' },
    },

    // Building footprints, flat, under the 3D shapes.
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-color': '#11151d',
        'fill-outline-color': '#161b24',
      },
    },

    // The 3D part: the footprints lifted into blocks.
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
        'fill-extrusion-color': '#1b222d',
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    },

    ...roadLayers(),

    // Road names.
    {
      id: 'road-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 12,
      filter: classes([...ROADS.major, ...ROADS.medium, ...ROADS.minor]),
      layout: {
        'symbol-placement': 'line',
        'symbol-sort-key': ['match', ['get', 'class'], 'motorway', 0, 'trunk', 1, 'primary', 2, 'secondary', 3, 'tertiary', 4, 5],
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 16, 13],
        'text-letter-spacing': 0.06,
      },
      paint: {
        'text-color': '#8f9db3',
        'text-halo-color': '#080a0e',
        'text-halo-width': 1.1,
      },
    },

    // Streets that are not part of the road network (footways, places).
    {
      id: 'street-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 14,
      filter: ['==', ['get', 'class'], 'street'],
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 12],
      },
      paint: {
        'text-color': '#77839a',
        'text-halo-color': '#080a0e',
        'text-halo-width': 1.1,
      },
    },

    // Towns and neighbourhoods.
    {
      id: 'place-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'neighbourhood']]],
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13, 'village', 12, 11],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
      },
      paint: {
        'text-color': '#b9c4d6',
        'text-halo-color': '#080a0e',
        'text-halo-width': 1.2,
      },
    },
  ],
};

export default MAP_STYLE;
