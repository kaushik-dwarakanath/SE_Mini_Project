# SE Mini Project — SimpleChat

A simple chat application with a React + Vite frontend and a Node.js + Express backend. The backend uses MongoDB/Mongoose for user storage and bcryptjs for password hashing.

## Prerequisites

Install the following:

- Node.js and npm
- MongoDB running locally, or a MongoDB Atlas connection URI
- Git (optional)

Verify Node.js and npm:

```bash
node --version
npm --version
```

## Project structure

```text
SE_Mini_Project/
├── code/
│   ├── backend/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── server.js
│   │   ├── package.json
│   │   └── .env.example
│   ├── frontend/
│   │   ├── src/
│   │   ├── package.json
│   │   └── vite.config.js
├── .gitignore
└── README.md
```

## 1. Run the backend

From the repository root:

```bash
cd code/backend
npm install
cp .env.example .env
```

Edit `code/backend/.env` and configure your environment variables. For local MongoDB, use:

```dotenv
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/simplechat
JWT_SECRET=replace-this-with-a-long-random-secret
```

Ensure MongoDB is running before starting the backend.

Start the backend:

```bash
npm start
```

The backend listens on `http://localhost:5000` by default.

Health endpoint: `http://localhost:5000/api/health`

## 2. Run the frontend

Open a second terminal from the repository root:

```bash
cd code/frontend
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

Keep both frontend and backend running during development.

## Environment variables

| Variable        | Purpose                      | Example                                  |
| --------------- | ---------------------------- | ---------------------------------------- |
| `PORT`        | Backend server port          | `5000`                                 |
| `MONGODB_URI` | MongoDB connection URI       | `mongodb://127.0.0.1:27017/simplechat` |
| `JWT_SECRET`  | Secret used for signing JWTs | Use your own long, random secret         |

The committed `.env.example` must contain placeholders only. Never commit your actual `.env` file, database credentials, tokens, or production secrets.

## Backend endpoints

| Method | Endpoint        | Purpose              |
| ------ | --------------- | -------------------- |
| GET    | `/api/health` | Check backend status |
| POST   | `/register`   | Register a user      |
| POST   | `/login`      | Log in               |

Registration requires `username`, `email`, and `password` in a JSON request body. Passwords must be at least eight characters and should be hashed before storage.

## Troubleshooting

- **MongoDB connection error:** Check that MongoDB is running and the connection URI is correct.
- **Missing environment variables:** Confirm that `code/backend/.env` exists and contains the required values.
- **Frontend cannot reach backend:** Ensure the backend is running on port `5000`.
- **Port already in use:** Change `PORT` in the backend `.env` and update the Vite proxy configuration to match.

## Security and Git hygiene

- Keep `.env` files and credentials out of Git.
- Commit `.env.example` with placeholder values only.
- Do not commit `node_modules`, build output, logs, or local editor files.
