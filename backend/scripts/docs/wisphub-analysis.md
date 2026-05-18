# WispHub Analysis — ISP Manager Reference

> Scraped: 2/5/2026, 11:14:53 a. m.
> Owner account — read-only analysis for ISP Manager improvements

## 1. Dashboard Widgets
- $0.00 HOY - 0 PAGOS
- $2,730,000.00 PENDIENTE - 42 PAGOS
- $0.00 MAYO - 0 PAGOS
- 0 HOY
- 0 MAYO
- 26 TOTAL
- 0 HOY
- 0 PENDIENTES
- 0 MAYO
- 0 GiB TOTAL DESCARGA
- 0 GiB TOTAL SUBIDA

## 2. Client List
**Columns:** 

**Add Client Form Fields:**
- `country` (hidden)
- `phone_number` (tel)
- `first_name` (text)
- `email` (email)
- `wa-message` (null)
- `sl` (text)
- `tl` (text)
- `query` (text)
- `gtrans` (text)
- `vote` (text)

## 3. Client Detail Sections

**Fields visible:**

## 4. Router List
**Columns:** 

**Add Router Form Fields:**
- `country` (hidden)
- `phone_number` (tel)
- `first_name` (text)
- `email` (email)
- `wa-message` (null)
- `sl` (text)
- `tl` (text)
- `query` (text)
- `gtrans` (text)
- `vote` (text)

## 5. Router Detail Fields

## 6. Payments
**Columns:** 

**Add Payment Form Fields:**
- `country` (hidden)
- `phone_number` (tel)
- `first_name` (text)
- `email` (email)
- `wa-message` (null)
- `sl` (text)
- `tl` (text)
- `query` (text)
- `gtrans` (text)
- `vote` (text)

## 7. Invoices
**Columns:** 

## 8. Service Plans
**Columns:** 

**Fields:**
- `country` (hidden)
- `phone_number` (tel)
- `first_name` (text)
- `email` (email)
- `wa-message` (null)
- `sl` (text)
- `tl` (text)
- `query` (text)
- `gtrans` (text)
- `vote` (text)

## 9. Zones
**Columns:** 

## 10. PPPoE Services
**Columns:** 

**Service Form Fields:**
- `country` (hidden)
- `phone_number` (tel)
- `first_name` (text)
- `email` (email)
- `wa-message` (null)
- `sl` (text)
- `tl` (text)
- `query` (text)
- `gtrans` (text)
- `vote` (text)

## 11. Navigation Menu
- [Lista de Precios](https://wisphub.net/precios/)
- [Formas de pago](https://wisphub.net/#pay-list)
- [Características](/caracteristicas/)
- [Demo](/solicitar-demo/)
- [Preguntas Frecuentes](https://wisphub.net/#FAQs)
- [Comprar Licencia](/comprar-licencia/)
- [Manual De Usuario](https://wisphub.net/documentacion/home-1/)
- [Contacto](/contacto/)
- [Ir Al Panel](/panel/)
- [Cerrar Sesión](/accounts/logout/)
- [Traductor](https://translate.google.com)

## 12. Raw Data
```json
{
  "dashboard": {
    "widgets": [
      "",
      "",
      "",
      "",
      "",
      "",
      "$0.00\nHOY - 0 PAGOS",
      "$2,730,000.00\nPENDIENTE - 42 PAGOS",
      "$0.00\nMAYO - 0 PAGOS",
      "0\nHOY",
      "0\nMAYO",
      "26\nTOTAL",
      "0\nHOY",
      "0\nPENDIENTES",
      "0\nMAYO",
      "0 GiB\nTOTAL DESCARGA",
      "0 GiB\nTOTAL SUBIDA"
    ],
    "title": "Dashboard - internet-online"
  },
  "clients": {
    "url": "/panel/clientes/",
    "finalUrl": "https://wisphub.app/panel/",
    "status": 200,
    "headers": [],
    "firstRow": [],
    "formFields": [
      {
        "name": "country",
        "type": "hidden",
        "label": "country"
      },
      {
        "name": "phone_number",
        "type": "tel",
        "label": "Escribe tu teléfono"
      },
      {
        "name": "first_name",
        "type": "text",
        "label": "Escribe tu nombre"
      },
      {
        "name": "email",
        "type": "email",
        "label": "Escribe tu email"
      },
      {
        "name": "wa-message",
        "type": null,
        "label": "Escribe tu mensaje"
      },
      {
        "name": "sl",
        "type": "text",
        "label": "sl"
      },
      {
        "name": "tl",
        "type": "text",
        "label": "tl"
      },
      {
        "name": "query",
        "type": "text",
        "label": "query"
      },
      {
        "name": "gtrans",
        "type": "text",
        "label": "gtrans"
      },
      {
        "name": "vote",
        "type": "text",
        "label": "vote"
      }
    ]
  },
  "routers": {
    "url": "/panel/routers/",
    "finalUrl": "https://wisphub.app/panel/routers/",
    "status": 404,
    "headers": [],
    "firstRow": [],
    "formFields": [
      {
        "name": "country",
        "type": "hidden",
        "label": "country"
      },
      {
        "name": "phone_number",
        "type": "tel",
        "label": "Escribe tu teléfono"
      },
      {
        "name": "first_name",
        "type": "text",
        "label": "Escribe tu nombre"
      },
      {
        "name": "email",
        "type": "email",
        "label": "Escribe tu email"
      },
      {
        "name": "wa-message",
        "type": null,
        "label": "Escribe tu mensaje"
      },
      {
        "name": "sl",
        "type": "text",
        "label": "sl"
      },
      {
        "name": "tl",
        "type": "text",
        "label": "tl"
      },
      {
        "name": "query",
        "type": "text",
        "label": "query"
      },
      {
        "name": "gtrans",
        "type": "text",
        "label": "gtrans"
      },
      {
        "name": "vote",
        "type": "text",
        "label": "vote"
      }
    ]
  },
  "payments": {
    "url": "/panel/pagos/",
    "finalUrl": "https://wisphub.app/panel/pagos/",
    "status": 404,
    "headers": [],
    "firstRow": [],
    "formFields": [
      {
        "name": "country",
        "type": "hidden",
        "label": "country"
      },

```