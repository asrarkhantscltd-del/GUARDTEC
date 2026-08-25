<div align="center">

<img src="frontend/public/logo-on-dark.svg" alt="GuardTec Logo" width="280"/>

# GuardTec Compliance Platform

**Enterprise compliance management for UK security companies**

![Stack](https://img.shields.io/badge/Stack-Node.js%20%7C%20React%20%7C%20PostgreSQL-blue?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![Standard](https://img.shields.io/badge/Standard-BS%207858%3A2019-red?style=flat-square)
![GDPR](https://img.shields.io/badge/Compliant-UK%20GDPR-green?style=flat-square)
![License](https://img.shields.io/badge/License-Private-lightgrey?style=flat-square)

</div>

---

## Overview

GuardTec is a full-stack compliance platform built specifically for UK licensed security companies. It replaces spreadsheets and paper-based vetting with a centralised, role-aware system — covering staff vetting, licence tracking, fleet management, agency operations, and automated compliance alerts.

---

## Core Modules

| Module | Description |
|---|---|
| **Staff Vetting** | BS 7858:2019 onboarding wizard, 12-phase screening, document uploads |
| **Compliance Tracking** | SIA licence, CSCS, DBS, Right to Work — with 30/60/90 day expiry alerts |
| **Fleet Management** | Vehicle register, MOT/insurance tracking, driver assignment |
| **Agency Portal** | Multi-agency login, cover guard deployment, acknowledgment system |
| **Incident Reporting** | Anonymous reporting with director moderation |
| **Event Instructions** | Digital acknowledgment forms with e-signature |
| **Custom Forms** | Form builder with live preview and response tracking |
| **Internal Messaging** | Staff messaging with file/photo/video attachments |
| **n8n Automation** | Compliance alerts, onboarding pipeline, payroll prep reports |

---

## Tech Stack

```
Frontend    React 18 + TypeScript + Vite + Tailwind CSS
Backend     Node.js + Express
Database    PostgreSQL 16
Auth        JWT (httpOnly cookies) + CSRF double-submit
Automation  n8n (self-hosted)
Deploy      Docker Compose + Nginx
```

---

## Roles & Access

- **Director** — Full access, incident moderation, user management
- **Ops Manager** — Staff, fleet, deployments
- **HR** — Vetting, onboarding, documents
- **Agency** — Separate portal, own staff and deployments
- **Staff** — Self-service profile, documents, messaging

---

## Compliance Standards

- **BS 7858:2019** — Security industry screening standard
- **UK GDPR** — Data protection, retention, and purpose limitation
- **SIA Licensing** — Private Security Industry Act 2001
- **Right to Work** — Immigration, Asylum and Nationality Act 2006

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/asrarkhantscltd-del/GUARDTEC.git
cd GUARDTEC

# 2. Create your .env file (see .env.example)
cp .env.example .env

# 3. Start all services
docker compose up -d
```

App runs at `http://localhost:5173`

---

<div align="center">

Built by **Asrar Khan** · GuardTec Security Ltd · UK

</div>
