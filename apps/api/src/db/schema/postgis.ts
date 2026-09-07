import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

/**
 * PostGIS column types Drizzle cannot express natively. On write the JS value is WKT
 * (`LINESTRING(lon lat, ...)` / `POLYGON((lon lat, ...))`) and is wrapped in `ST_GeomFromText`
 * with SRID 4326; on read node-postgres hands back the hex EWKB string PostGIS emits by default.
 * Select `ST_AsText(col)` / `ST_AsGeoJSON(col)` explicitly when a readable form is needed.
 */
export const geographyLineString = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(LineString,4326)';
  },
  toDriver(value) {
    return sql`ST_GeogFromText(${value})`;
  },
});

export const geometryPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Polygon,4326)';
  },
  toDriver(value) {
    return sql`ST_GeomFromText(${value}, 4326)`;
  },
});

/** `bytea`, absent from drizzle-orm/pg-core; maps to a Node Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
