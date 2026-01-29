# How to Run the Backend Server

This guide explains how to set up and run the Node.js backend server for the Inheritance Demo.

## Prerequisites

-   Node.js (v16+ recommended)
-   npm (comes with Node.js)

## Setup

1.  Navigate to the `app` directory:
    ```bash
    cd app
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  **Environment Variables**:
    -   Ensure you have a `.env` file in the `app` directory.
    -   If not, you can copy the example:
        ```bash
        cp .env.example .env
        ```
    -   Open `.env` and configure the necessary variables (e.g., RPC URL, Keypair paths).

## Running the Server

### Development Mode
To run the server with hot-reloading (restarts on file changes):

```bash
npm run dev
```

### Production Mode
To run the server normally:

```bash
npm start
```

## Troubleshooting

-   **Port Conflicts**: By default, the server usually runs on port 3000 (check `src/index.js` or `.env`). If that port is busy, change the `PORT` in `.env`.
-   **Dependencies**: If you encounter missing modules, try deleting `node_modules` and `package-lock.json`, then run `npm install` again.
