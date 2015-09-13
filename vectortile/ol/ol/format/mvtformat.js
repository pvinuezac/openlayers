//FIXME Implement projection handling

goog.provide('ol.format.MVT');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('ol.Feature');
goog.require('ol.FlyweightFeature');
goog.require('ol.ext.pbf');
goog.require('ol.ext.vectortile');
goog.require('ol.format.Feature');
goog.require('ol.format.FormatType');
goog.require('ol.geom.Geometry');
goog.require('ol.geom.GeometryLayout');
goog.require('ol.geom.GeometryType');
goog.require('ol.geom.LineString');
goog.require('ol.geom.MultiLineString');
goog.require('ol.geom.MultiPoint');
goog.require('ol.geom.Point');
goog.require('ol.geom.Polygon');
goog.require('ol.proj');
goog.require('ol.proj.Projection');
goog.require('ol.proj.Units');



/**
 * @classdesc
 * Feature format for reading data in the Mapbox MVT format.
 *
 * @constructor
 * @extends {ol.format.Feature}
 * @param {olx.format.MVTOptions=} opt_options Options.
 * @api
 */
ol.format.MVT = function(opt_options) {

  goog.base(this);

  var options = goog.isDef(opt_options) ? opt_options : {};

  /**
   * @type {ol.proj.Projection}
   */
  this.defaultDataProjection = new ol.proj.Projection({
    code: 'EPSG:3857',
    units: ol.proj.Units.TILE_PIXELS
  });

  /**
  * @private
   * @type {boolean}
   */
  this.flyweight_ = goog.isDef(options.flyweight) ? options.flyweight : false;

  /**
   * @private
   * @type {string}
   */
  this.geometryName_ = goog.isDef(options.geometryName) ?
      options.geometryName : 'geometry';

  /**
   * @private
   * @type {string}
   */
  this.layerName_ = goog.isDef(options.layerName) ? options.layerName : 'layer';

  /**
   * @private
   * @type {Array.<string>}
   */
  this.layers_ = goog.isDef(options.layers) ? options.layers : null;

};
goog.inherits(ol.format.MVT, ol.format.Feature);


/**
 * @inheritDoc
 */
ol.format.MVT.prototype.getType = function() {
  return ol.format.FormatType.ARRAY_BUFFER;
};


/**
 * @private
 * @param {Object} rawFeature Raw Mapbox feature.
 * @param {string} layer Layer.
 * @param {olx.format.ReadOptions=} opt_options Read options.
 * @return {ol.Feature} Feature.
 */
ol.format.MVT.prototype.readFeature_ = function(
    rawFeature, layer, opt_options) {
  var feature = new ol.Feature();
  var values = rawFeature.properties;
  values[this.layerName_] = layer;
  var geometry = ol.format.Feature.transformWithOptions(
      ol.format.MVT.readGeometry_(rawFeature), false,
      this.adaptOptions(opt_options));
  if (!goog.isNull(geometry)) {
    goog.asserts.assertInstanceof(geometry, ol.geom.Geometry);
    values[this.geometryName_] = geometry;
  }
  feature.setValues(rawFeature.properties);
  feature.setGeometryName(this.geometryName_);
  return feature;
};


/**
 * @private
 * @param {Object} rawFeature Raw Mapbox feature.
 * @param {string} layer Layer.
 * @return {ol.FlyweightFeature} Feature.
 */
ol.format.MVT.prototype.readFlyweightFeature_ = function(rawFeature, layer) {
  var coords = rawFeature.loadGeometry();
  var end = 0;
  var ends = [];
  var flatCoordinates = [];
  var line, coord;
  for (var i = 0, ii = coords.length; i < ii; ++i) {
    line = coords[i];
    for (var j = 0, jj = line.length; j < jj; ++j) {
      coord = line[j];
      // Non-tilespace coords can be calculated here when a TileGrid and
      // TileCoord are known.
      flatCoordinates.push(coord.x, coord.y);
    }
    end += 2 * j;
    ends.push(end);
  }

  var type = rawFeature.type;
  /** @type {ol.geom.GeometryType} */
  var geometryType;
  if (type === 1) {
    geometryType = coords.length === 1 ?
        ol.geom.GeometryType.POINT : ol.geom.GeometryType.MULTI_POINT;
  } else if (type === 2) {
    if (coords.length === 1) {
      geometryType = ol.geom.GeometryType.LINE_STRING;
    } else {
      geometryType = ol.geom.GeometryType.MULTI_LINE_STRING;
    }
  } else {
    geometryType = ol.geom.GeometryType.POLYGON;
  }

  var properties = rawFeature.properties;
  properties[this.layerName_] = layer;

  return new ol.FlyweightFeature(
      geometryType, flatCoordinates, ends, rawFeature.properties);
};


/**
 * @inheritDoc
 */
ol.format.MVT.prototype.readFeatures = function(source, opt_options) {
  goog.asserts.assertInstanceof(source, ArrayBuffer);

  var layers = this.layers_;

  var pbf = new ol.ext.pbf(source);
  var tile = new ol.ext.vectortile.VectorTile(pbf);
  var features = [];
  var flyweight = this.flyweight_;
  var layer, feature;
  for (var name in tile.layers) {
    if (!goog.isNull(layers) && !goog.array.contains(layers, name)) {
      continue;
    }
    layer = tile.layers[name];

    for (var i = 0, ii = layer.length; i < layer.length; ++i) {
      if (flyweight) {
        feature = this.readFlyweightFeature_(layer.feature(i), name);
      } else {
        feature = this.readFeature_(layer.feature(i), name, opt_options);
      }
      features.push(feature);
    }
  }

  return features;
};


/**
 * @inheritDoc
 */
ol.format.MVT.prototype.readProjection = function(source) {
  return this.defaultDataProjection;
};


/**
 * Sets the layers that features will be read from.
 * @param {Array.<string>} layers Layers.
 * @api
 */
ol.format.MVT.prototype.setLayers = function(layers) {
  this.layers_ = layers;
};


/**
 * @private
 * @param {Object} rawFeature Raw Mapbox feature.
 * @return {ol.geom.Geometry} Geometry.
 */
ol.format.MVT.readGeometry_ = function(rawFeature) {
  var type = rawFeature.type;
  if (type === 0) {
    return null;
  }

  var coords = rawFeature.loadGeometry();

  var end = 0;
  var ends = [];
  var flatCoordinates = [];
  var line, coord;
  for (var i = 0, ii = coords.length; i < ii; ++i) {
    line = coords[i];
    for (var j = 0, jj = line.length; j < jj; ++j) {
      coord = line[j];
      // Non-tilespace coords can be calculated here when a TileGrid and
      // TileCoord are known.
      flatCoordinates.push(coord.x, coord.y);
    }
    end += 2 * j;
    ends.push(end);
  }

  var geom;
  if (type === 1) {
    geom = coords.length === 1 ?
        new ol.geom.Point() : new ol.geom.MultiPoint();
  } else if (type === 2) {
    if (coords.length === 1) {
      geom = new ol.geom.LineString();
    } else {
      geom = new ol.geom.MultiLineString();
    }
  } else {
    geom = new ol.geom.Polygon();
  }

  geom.setFlatCoordinatesInternal(ol.geom.GeometryLayout.XY, flatCoordinates,
      ends);

  return geom;
};