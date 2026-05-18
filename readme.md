<div align="center">

# ShipEx — Backend

### REST API for the ShipEx parcel delivery platform

[![Frontend Repo](https://img.shields.io/badge/Frontend-Repo-181717?style=for-the-badge&logo=github)](https://github.com/Riad-Zz/ShipEx)
[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-projectshipex.vercel.app-4CAF50?style=for-the-badge)](https://projectshipex.vercel.app/)

</div>

---

## Overview

This is the Express + MongoDB backend for ShipEx. It handles parcel management, role-based auth via Firebase Admin SDK, Stripe payment processing, timeline logging, and role-specific dashboard aggregations.

**Full documentation, features, and setup instructions are in the [Frontend Repository](https://github.com/Riad-Zz/ShipEx).**

---

## Tech Stack

<p>
  <img src="https://skillicons.dev/icons?i=nodejs" title="Node.js" />
  <img src="https://skillicons.dev/icons?i=express" title="Express" />
  <img src="https://skillicons.dev/icons?i=mongodb" title="MongoDB" />
  <img src="https://skillicons.dev/icons?i=firebase" title="Firebase Admin SDK" />
</p>

| Technology | Purpose |
|---|---|
| Node.js + Express | REST API server |
| MongoDB + MongoDB Atlas | Database |
| Firebase Admin SDK | Server-side token verification |
| Stripe | Payment session creation & verification |

---

## Quick Start

```bash
git clone https://github.com/Riad-Zz/ShipEx_Server.git
cd ShipEx_Server
npm install
```

Create `.env`:
```env
PORT=5000
MONGO_URI=
STRIPE_KEY=
STRIPE_DOMAIN=http://localhost:5173
FIREBASE_KEY=        # base64-encoded Firebase service account JSON
```

```bash
node index.js
```

---

## Deployment

Deployed on **Render**. Connect the repo to Render and set all env vars in the dashboard. The `client.connect()` call and ping command in `index.js` are intentionally commented out for serverless compatibility — leave them as is.

---

## Author

**Riadul Islam Riad** — [GitHub](https://github.com/Riad-Zz)