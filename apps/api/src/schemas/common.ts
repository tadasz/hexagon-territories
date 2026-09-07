import { Kind, Type, TypeRegistry, type TSchema } from '@sinclair/typebox';

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
