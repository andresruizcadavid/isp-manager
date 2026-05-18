# WispHub Analysis — ISP Manager Reference

> Generated: 2026-05-02T16:49:26.466Z
> Purpose: Understand data models to build a better minimal ISP system

## 1. Client Data Model
### Fields found:
- `id_servicio`: 26
- `usuario`: 0026maria_godoy_urrea@internet-online
- `nombre`: 0026maria_godoy_urrea
- `email`: 
- `email_cc`: 
- `razon_social`: 
- `tipo_persona`: Fisica/Natural
- `cedula`: 
- `direccion`: 
- `localidad`: 
- `ciudad`: 
- `telefono`: 
- `descuento`: 0.00
- `saldo`: 0.00
- `rfc`: 
- `informacion_adicional`: 
- `notificacion_sms`: true
- `aviso_pantalla`: true
- `notificaciones_push`: true
- `auto_activar_servicio`: false
- `firewall`: true
- `servicio`: 0026maria_godoy_urrea
- `password_servicio`: wdd9d42z
- `server_hotspot`: 
- `ip`: 172.16.60.28
- `ip_local`: 172.16.60.1
- `estado`: Activo
- `modelo_antena`: null
- `password_cpe`: 
- `mac_cpe`: 
- `interfaz_lan`: VLAN_INTERNET
- `modelo_router_wifi`: 
- `ip_router_wifi`: null
- `mac_router_wifi`: 
- `usuario_router_wifi`: 
- `password_router_wifi`: 
- `ssid_router_wifi`: 
- `password_ssid_router_wifi`: 0026maria_godoy_urrea2026i
- `comentarios`: 
- `coordenadas`: 
- `costo_instalacion`: 
- `precio_plan`: 65000.00
- `forma_contratacion`: -------------
- `sn_onu`: 
- `estado_facturas`: Pagadas
- `fecha_instalacion`: 30/04/2026 11:07:00
- `fecha_cancelacion`: null
- `fecha_corte`: 8/05/2026
- `ultimo_cambio`: 30/04/2026 11:08:11
- `plan_internet`: {"id":439219,"nombre":"Online_basico"}
- `zona`: {"id":63850,"nombre":"LA ESTRELLA / SAN VICENTE"}
- `router`: {"id":63679,"nombre":"LA ESTRELLA / SAN VICENTE","falla_gene
- `sectorial`: null
- `tecnico`: {"id":6030718,"nombre":""}

**Total clients:** 26

## 2. Router Data Model
### Fields found:
- `id`: 63679
- `nombre`: LA ESTRELLA / SAN VICENTE
- `ip`: 172.25.170.210
- `falla_general`: false
- `falla_general_descripcion`: 

## 3. Invoice Data Model
### Fields found:
- `id_factura`: 43
- `folio`: null
- `fecha_emision`: 2026-04-25
- `fecha_vencimiento`: 2026-05-08
- `fecha_pago`: 2026-05-01T00:00:00-05:00
- `estado`: Pendiente de Pago
- `tipo`: 1
- `zona`: {"id":63850,"nombre":"LA ESTRELLA / SAN VICENTE"}
- `sub_total`: 65000
- `descuento`: 0
- `saldo`: 0
- `saldo_nuevo`: 0
- `impuestos_total`: 0
- `total_cobrado`: 65000
- `total`: 65000
- `comprobante_pago`: null
- `referencia`: 
- `referencia_oxxo`: 
- `total_oxxo`: 0
- `id_mercadopago`: 
- `id_payu`: 
- `url_payu`: 
- `total_pasarela`: 0
- `total_openpay`: 0
- `retencion_porcentaje`: 0
- `retenciones_total`: 0
- `forma_pago`: null
- `cajero`: {"id":6030718,"nombre":""}
- `cliente`: {"usuario":"0001_prueba@internet-online","nombre":"0001_prue
- `articulos`: [{"id":61453369,"uuid_equipo":null,"categoria_stock":null,"c

**Total invoices:** 24

## 4. Payment Data Model
> No dedicated endpoint. Payment data lives inside /facturas/.
> Payment-related fields visible inside an invoice include:
> `forma_pago`, `fecha_pago`, `comprobante_pago`, `total_cobrado`,
> `referencia`, `referencia_oxxo`, `id_mercadopago`, `id_payu`,
> `url_payu`, `total_pasarela`, `total_openpay`.

## 5. Service Plans
### Fields found (first plan):
- `id`: 451072
- `nombre`: Online Free
- `tipo`: PPPoE

**All plans (3):**
- **Online Free**: {"id":451072,"nombre":"Online Free","tipo":"PPPoE"}
- **Online_basico**: {"id":439219,"nombre":"Online_basico","tipo":"PPPoE"}
- ***1-pppoe**: {"id":439216,"nombre":"*1-pppoe","tipo":"PPPoE"}

## 6. Zones
### Fields found (first zone):
- `id`: 63850
- `nombre`: LA ESTRELLA / SAN VICENTE

**All zones (1):**
- **LA ESTRELLA / SAN VICENTE** (id=63850)

## 6.1 Tickets / Soporte
```json
{
  "count": 0,
  "next": null,
  "previous": null,
  "results": []
}
```

## 6.2 Staff
### Fields found:
- `id`: 6030718
- `username`: admin@internet-online
- `nombre`: 
- `email`: contacto@internetonline.co

**Total staff:** 2

## 7. Raw API Responses (first record each)
```json
{
  "client_sample": {
    "id_servicio": 26,
    "usuario": "0026maria_godoy_urrea@internet-online",
    "nombre": "0026maria_godoy_urrea",
    "email": "",
    "email_cc": "",
    "razon_social": "",
    "tipo_persona": "Fisica/Natural",
    "cedula": "",
    "direccion": "",
    "localidad": "",
    "ciudad": "",
    "telefono": "",
    "descuento": "0.00",
    "saldo": "0.00",
    "rfc": "",
    "informacion_adicional": "",
    "notificacion_sms": true,
    "aviso_pantalla": true,
    "notificaciones_push": true,
    "auto_activar_servicio": false,
    "firewall": true,
    "servicio": "0026maria_godoy_urrea",
    "password_servicio": "wdd9d42z",
    "server_hotspot": "",
    "ip": "172.16.60.28",
    "ip_local": "172.16.60.1",
    "estado": "Activo",
    "modelo_antena": null,
    "password_cpe": "",
    "mac_cpe": "",
    "interfaz_lan": "VLAN_INTERNET",
    "modelo_router_wifi": "",
    "ip_router_wifi": null,
    "mac_router_wifi": "",
    "usuario_router_wifi": "",
    "password_router_wifi": "",
    "ssid_router_wifi": "",
    "password_ssid_router_wifi": "0026maria_godoy_urrea2026i",
    "comentarios": "",
    "coordenadas": "",
    "costo_instalacion": "",
    "precio_plan": "65000.00",
    "forma_contratacion": "-------------",
    "sn_onu": "",
    "estado_facturas": "Pagadas",
    "fecha_instalacion": "30/04/2026 11:07:00",
    "fecha_cancelacion": null,
    "fecha_corte": "8/05/2026",
    "ultimo_cambio": "30/04/2026 11:08:11",
    "plan_internet": {
      "id": 439219,
      "nombre": "Online_basico"
    },
    "zona": {
      "id": 63850,
      "nombre": "LA ESTRELLA / SAN VICENTE"
    },
    "router": {
      "id": 63679,
      "nombre": "LA ESTRELLA / SAN VICENTE",
      "falla_general": false,
      "falla_general_descripcion": ""
    },
    "sectorial": null,
    "tecnico": {
      "id": 6030718,
      "nombre": ""
    }
  },
  "router_sample": {
    "id": 63679,
    "nombre": "LA ESTRELLA / SAN VICENTE",
    "ip": "172.25.170.210",
    "falla_general": false,
    "falla_general_descripcion": ""
  },
  "invoice_sample": {
    "id_factura": 43,
    "folio": null,
    "fecha_emision": "2026-04-25",
    "fecha_vencimiento": "2026-05-08",
    "fecha_pago": "2026-05-01T00:00:00-05:00",
    "estado": "Pendiente de Pago",
    "tipo": 1,
    "zona": {
      "id": 63850,
      "nombre": "LA ESTRELLA / SAN VICENTE"
    },
    "sub_total": 65000,
    "descuento": 0,
    "saldo": 0,
    "saldo_nuevo": 0,
    "impuestos_total": 0,
    "total_cobrado": 65000,
    "total": 65000,
    "comprobante_pago": null,
    "referencia": "",
    "referencia_oxxo": "",
    "total_oxxo": 0,
    "id_mercadopago": "",
    "id_payu": "",
    "url_payu": "",
    "total_pasarela": 0,
    "total_openpay": 0,
    "retencion_porcentaje": 0,
    "retenciones_total": 0,
    "forma_pago": null,
    "cajero": {
      "id": 6030718,
      "nombre": ""
    },
    "cliente": {
      "usuario": "0001_prueba@internet-online",
      "nombre": "0001_prueba",
      "email": "",
      "cedula": "",
      "direccion": "",
      "localidad": "",
      "telefono": "",
      "rfc": ""
    },
    "articulos": [
      {
        "id": 61453369,
        "uuid_equipo": null,
        "categoria_stock": null,
        "cantidad": 1,
        "descripcion": "Renta y mantenimiento de la red: LA ESTRELLA / SAN VICENTE\r\nPlan de Internet: Online_basico 65000.00\r\nPeriodo del 1/Abr./2026 al 30/Abr./2026\r\n",
        "precio": "65000.00",
        "servicio": {
          "id_servicio": 1
        }
      }
    ]
  },
  "payment_sample": {
    "note": "No dedicated endpoint. Payment data lives inside /facturas/."
  },
  "plan_sample": {
    "id": 451072,
    "nombre": "Online Free",
    "tipo": "PPPoE"
  },
  "zone_sample": {
    "id": 63850,
    "nombre": "LA ESTRELLA / SAN VICENTE"
  },
  "ticket_sample": {
    "count": 0,
    "next": null,
    "previous": null,
    "results": []
  },
  "staff_sample": {
    "id": 6030718,
    "username": "admin@internet-online",
    "nombre": "",
    "email": "contacto@internetonline.co"
  }
}
```

## 8. Improvements for our ISP Manager
*(To be filled after reviewing the data models above)*
- Fields we are missing vs WispHub
- Simplifications we can make
- Payment flow differences