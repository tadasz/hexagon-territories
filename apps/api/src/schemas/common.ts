import { FormatRegistry, Kind, Type, TypeRegistry, type TSchema } from '@sinclair/typebox';

// Formats used by the 002 schemas so `Value.Check` (config, export bundle tests) accepts them;
// Ajv (Fastify) ships its own implementations.
if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (value) => !Number.isNaN(Date.parse(value)));
}
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  );
}

/**
 * A string enum rendered as `{ type: 'string', enum: [...] }` instead of TypeBox's default
 * `anyOf` of literals, which reads better in the generated OpenAPI document and in the Swift
 * client generated from it. Registered with TypeBox's `TypeRegistry` so `Value.Check` /
 * `Value.Errors` (config validation) understand it; Ajv (Fastify) only sees the plain keywords.
 */
export interface TStringEnum<T extends string> extends TSchema {
  [Kind]: 'StringEnum';
  static: T;
  type: 'string';
  enum: T[];
}

const STRING_ENUM_KIND = 'StringEnum';

if (!TypeRegistry.Has(STRING_ENUM_KIND)) {
  TypeRegistry.Set(STRING_ENUM_KIND, (schema: unknown, value: unknown) => {
    const allowed = (schema as { enum?: unknown }).enum;
    return typeof value === 'string' && Array.isArray(allowed) && allowed.includes(value);
  });
}

export function StringEnum<const T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
): TStringEnum<T[number]> {
  return {
    ...options,
    [Kind]: STRING_ENUM_KIND,
    type: 'string',
    enum: [...values],
  } as unknown as TStringEnum<T[number]>;
}

/** `T | null` as an `anyOf` with `null`. */
export function Nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

/**
 * `T | null` rendered as `type: [<type>, 'null']` (JSON Schema 2020-12 / OpenAPI 3.1), which
 * `swift-openapi-generator` maps to an optional value; `Nullable` (anyOf) stays for legacy shapes.
 * Only for schemas with a single primitive `type`.
 */
export function OrNull<T extends TSchema>(schema: T): TSchema & { static: T['static'] | null } {
  const type = (schema as { type?: unknown }).type;
  if (typeof type !== 'string') throw new Error('OrNull needs a schema with a single `type`');
  return Type.Unsafe<T['static'] | null>({ ...schema, type: [type, 'null'] });
}

/** ISO 8601 UTC timestamp. */
export function DateTime(options: { description?: string } = {}) {
  return Type.String({ format: 'date-time', ...options });
}
