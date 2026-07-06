/**
 * Parse an abstract template (the user-facing YAML).
 */

export interface AbstractResource {
  logicalId: string;
  type: string;
  properties: Record<string, any>;
}

export interface AbstractTemplate {
  schemaPath: string;
  resources: AbstractResource[];
  toggles: Record<string, boolean>;
}

export function parseTemplate(raw: any): AbstractTemplate {
  const schemaPath = raw.Schema;
  if (!schemaPath) {
    throw new Error('Template must have a "Schema" field pointing to the schema file');
  }

  const resources: AbstractResource[] = [];
  if (raw.Resources) {
    for (const [logicalId, def] of Object.entries(raw.Resources)) {
      const d = def as any;
      resources.push({
        logicalId,
        type: d.Type,
        properties: d.Properties ?? {},
      });
    }
  }

  const toggles: Record<string, boolean> = {};
  if (raw.Toggles) {
    for (const [name, value] of Object.entries(raw.Toggles)) {
      toggles[name] = !!value;
    }
  }

  return { schemaPath, resources, toggles };
}
