"""Strict workbook reader; emit values only to the importer, never normalize text."""
import datetime
import json
import sys
import openpyxl

workbook = openpyxl.load_workbook(sys.argv[1], data_only=False)
result = {}
for sheet in workbook:
    rows = list(sheet.values)
    headers = rows[0]
    assert len(set(headers)) == len(headers)
    output = []
    for row in rows[1:]:
        values = []
        for header, value in zip(headers, row):
            if isinstance(value, datetime.datetime):
                if header in ("dob", "visit_date"):
                    assert value.time() == datetime.time()
                    value = value.date().isoformat()
                else:
                    value = value.isoformat(timespec="seconds")
            assert type(value) in (str, int), (sheet.title, header, type(value))
            values.append(value)
        output.append(values)
    result[sheet.title] = {"columns": list(headers), "rows": output}
print(json.dumps(result, ensure_ascii=False))
