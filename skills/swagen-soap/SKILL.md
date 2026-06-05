---
name: swagen-soap
description: SOAP/XML API testing rules — envelope validation, WS-Security, fault assertions, WSDL binding tests
trigger: SOAP/XML endpoint specs detected
---

# SOAP API Skill

Activates when the spec contains SOAP-related paths, tags, or XML content types.

## Detection

- Endpoint paths containing: `soap`, `wsdl`, `xmlrpc`, `.svc`
- Tags: `soap`, `wsdl`, `xmlrpc`, `wcf`, `ws-`, `enterprise service`
- Response content types: `application/soap+xml`, `text/xml`, `application/xml`

## Rules

1. **Envelope structure** — Validate Envelope, Header, Body with correct namespaces.
2. **WSDL operations** — Construct XML request body per the WSDL binding.
3. **Faults** — Test client and server faults; assert `faultcode`, `faultstring`, `detail`.
4. **SOAP version** — Verify SOAP 1.1 or 1.2 envelope.
5. **WS-Security** — Include `UsernameToken` or X.509 certificate in Header.
6. **Headers** — Test missing/malformed `Action`, `To`, `MessageID`.
7. **RPC-style** — Verify method name matches expected XML element.
8. **Document-style** — Verify XML matches XSD schema.
9. **XPath assertions** — Validate specific response nodes.
10. **Multiple bindings** — Tests per binding defined in WSDL.
11. **WS-Addressing** — Test `wsa:Action`, `wsa:To`, `wsa:MessageID`.
12. **No dead code** — Avoid duplicate tests and unused imports; they are stripped automatically after generation.
