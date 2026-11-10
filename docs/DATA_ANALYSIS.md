# Phase 1 – Source data analysis & field mapping

Source: `booking_report02-Nov-2026-05-01-PM.xlsx`, sheet **Worksheet**, **19,942 rows × 74 columns**.

## Findings
| Check | Result | Handling |
|---|---|---|
| CREATED DATE | text `DD/MM/YYYY`, 17-09-2026 → 02-11-2026, 0 invalid | Parsed as DD/MM (Indian), stored as `booking_date` |
| AWB NUMBER | 19,942 unique, **0 duplicates**; 15,765 numeric + 4,177 alphanumeric (`IN1214551`) | Stored as TEXT, UNIQUE |
| `ORIGIN HUB CODE\n` | heading has trailing newline | Headings normalised; values DEL 18,128 · BOM 1,586 · BLR 228 |
| IS HOLD? | YES 381 / NO 19,561 | → `is_hold` boolean. (AWB STATE also has SHIPMENT HOLD/UNHOLD – informational) |
| SALESMAN NAME | 33 names, **740 blank**, includes system logins (`admin@skynetww.com`, `blrops1`) | Blank → “Unassigned”; names kept as in source |
| Customers | 717 codes, exactly one name per code | Grouped by code |
| CONSIGNEE COUNTRY | 66 countries, 2 blank | → `destination_country` |
| CUSTOMER GRAND TOTAL | Σ ₹12,31,95,328.91; 2 blank; 437 zero (348 CANCELLED, 79 RTO …) | Blank → 0 + flag `GRAND_TOTAL_BLANK`; zero rows kept |
| Grand total check | = Taxable + CGST + SGST + IGST for 98.7 % rows | Grand total used as-is; **GST never added again** |
| Taxable vs Freight+Other | differs on 3,690 rows because of SALES FSC % (fuel surcharge) | Informational only |
| CHARGEABLE WT.(KG.) | Σ 3,58,211.7 KG, no blanks / negatives | `numeric(12,3)` |
| SHIPMENT CURRENCY | 14 currencies (INR 13,383, CAD 3,626, GBP 2,282, USD 584 …) | Applies to declared SHIPMENT VALUE – **not revenue, never summed** |
| MISC AMOUNT | 100 % empty | Preserved in raw data |

**Assumption to confirm with the business owner:** CUSTOMER GRAND TOTAL is billed in INR. If not, choose the billing currency at import time; approved rates come from *Settings → Exchange rates* and the original amount is kept in `grand_total_original`.

## Field mapping (Excel → database)
| Excel column | DB column | Used for |
|---|---|---|
| AWB NUMBER | awb_number (UNIQUE) | key |
| CREATED DATE | booking_date | all date filters / trends |
| CUSTOMER NAME / CUSTOMER CODE / CUSTOMER TYPE | customer_name / customer_code / customer_type | customer analysis |
| SHIPPER CITY / STATE / COUNTRY | shipper_city / shipper_state / shipper_country | city & state analysis |
| CONSIGNEE COUNTRY / CITY | destination_country / destination_city | country analysis |
| CHARGEABLE WT.(KG.) | chargeable_weight | weight KPIs |
| ACTUAL WEIGHT / VOLUMETRIC WEIGHT / PCS | actual_weight / volumetric_weight / pcs | detail |
| IS HOLD? | is_hold | hold management |
| CUSTOMER GRAND TOTAL | customer_grand_total | **revenue** |
| CUSTOMER FREIGHT / OTHER CHARGE TOTAL / TAXABLE AMOUNT / CGST / SGST / IGST / SALES FSC % | customer_freight / customer_other_charges / customer_taxable_amount / customer_cgst / customer_sgst / customer_igst / sales_fsc_percent | financial breakdown |
| SALESMAN NAME | salesperson_name | sales analysis + Sales-user data scope |
| ORIGIN HUB CODE↵ | origin_hub_code | hub analysis + Manager data scope |
| SERVICE NAME / VENDOR NAME / PRODUCT NAME / AWB STATE / ENTRY TYPE | service_name / vendor_name / product_name / awb_state / entry_type | filters & detail |
| SHIPMENT VALUE / SHIPMENT CURRENCY | shipment_value / shipment_currency | declared value only |
| **all 74 columns** | raw_excel_data (JSONB) | AWB detail drawer, nothing lost |

Alternative headings recognised automatically are listed in `FIELDS` in `js/excel-import.js` (e.g. *BOOKING DATE*, *CHARGEABLE WEIGHT*, *SALESPERSON*, *DESTINATION COUNTRY*, *HOLD STATUS*). Admins can save more from the import mapping step.

## Data quality flags stored per AWB
`SALESMAN_BLANK`, `GRAND_TOTAL_BLANK`, `WEIGHT_BLANK`, `CUSTOMER_BLANK`, `HOLD_VALUE_UNKNOWN`, `NUMBER_INVALID`.
