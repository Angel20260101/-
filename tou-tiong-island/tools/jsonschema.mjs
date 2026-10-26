/**
 * 極簡 JSON Schema (draft-07 子集) 驗證器 —— 零外部依賴。
 * 支援：type / required / properties / additionalProperties / items /
 *       minItems / maxItems / minLength / maxLength / pattern / enum / const /
 *       minimum / maximum / minProperties / $ref（僅限 #/definitions/*）。
 * 刻意不支援完整規格：CI 與 Netlify build 不應該為了跑驗證而安裝套件。
 */
export function validate(schema, data, { root = schema, path = '$' } = {}) {
  const errors = [];
  const push = (msg) => errors.push(`${path}: ${msg}`);

  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    return validate(target, data, { root, path });
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, data))) {
      push(`型別應為 ${types.join('|')}，實際為 ${jsType(data)}`);
      return errors;
    }
  }

  if ('const' in schema && data !== schema.const) push(`必須等於 ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(data)) push(`必須是 ${schema.enum.join(' / ')} 之一，實際為 ${JSON.stringify(data)}`);

  if (typeof data === 'string') {
    if (schema.minLength != null && data.length < schema.minLength) push(`長度至少 ${schema.minLength}`);
    if (schema.maxLength != null && data.length > schema.maxLength) push(`長度至多 ${schema.maxLength}（實際 ${data.length}）`);
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) push(`「${data}」不符合格式 ${schema.pattern}`);
  }

  if (typeof data === 'number') {
    if (schema.minimum != null && data < schema.minimum) push(`不得小於 ${schema.minimum}`);
    if (schema.maximum != null && data > schema.maximum) push(`不得大於 ${schema.maximum}`);
  }

  if (Array.isArray(data)) {
    if (schema.minItems != null && data.length < schema.minItems) push(`至少 ${schema.minItems} 個項目`);
    if (schema.maxItems != null && data.length > schema.maxItems) push(`至多 ${schema.maxItems} 個項目（實際 ${data.length}）`);
    if (schema.items) {
      data.forEach((item, i) => errors.push(...validate(schema.items, item, { root, path: `${path}[${i}]` })));
    }
  }

  if (isPlainObject(data)) {
    if (schema.minProperties != null && Object.keys(data).length < schema.minProperties) {
      push(`至少需要 ${schema.minProperties} 個欄位`);
    }
    for (const key of schema.required ?? []) {
      if (!(key in data)) push(`缺少必填欄位「${key}」`);
    }
    const props = schema.properties ?? {};
    for (const [key, value] of Object.entries(data)) {
      if (props[key]) {
        errors.push(...validate(props[key], value, { root, path: `${path}.${key}` }));
      } else if (schema.additionalProperties === false) {
        push(`不允許的欄位「${key}」`);
      }
    }
  }

  return errors;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`只支援內部 $ref，收到 ${ref}`);
  return ref.slice(2).split('/').reduce((acc, part) => acc[part], root);
}

function matchesType(type, data) {
  switch (type) {
    case 'object': return isPlainObject(data);
    case 'array': return Array.isArray(data);
    case 'string': return typeof data === 'string';
    case 'number': return typeof data === 'number' && Number.isFinite(data);
    case 'integer': return Number.isInteger(data);
    case 'boolean': return typeof data === 'boolean';
    case 'null': return data === null;
    default: return true;
  }
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const jsType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
