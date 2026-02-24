import json

with open("C:/Users/Eric Luciano/OneDrive/Documentos/GitHub/pipedrive-mcp/fields_raw.json", "r", encoding="utf-8") as f:
    data = json.load(f)

fields = []
for field in data["data"]:
    if field.get("edit_flag") and field.get("key") and len(field["key"]) > 10:
        entry = {
            "key": field["key"],
            "name": field["name"],
            "type": field["field_type"],
        }
        if field.get("options"):
            entry["options"] = [o["label"] for o in field["options"]]
        fields.append(entry)

for f in fields:
    opts = f.get("options", [])
    opts_str = f"  | Opcoes: {opts}" if opts else ""
    print(f'{f["type"]:15s} | {f["name"]}{opts_str}')

print(f"\nTotal: {len(fields)} campos")

with open("C:/Users/Eric Luciano/OneDrive/Documentos/GitHub/pipedrive-mcp/fields_parsed.json", "w", encoding="utf-8") as f:
    json.dump(fields, f, indent=2, ensure_ascii=False)
