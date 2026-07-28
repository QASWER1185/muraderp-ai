import express from "express";

const app = express();
const PORT = 3000;

app.get("/", (_req, res) => {
  res.send("🚀 Welcome to MuradERP-AI Backend");
});

app.listen(PORT, () => {
  console.log(`MuradERP-AI Server is running on http://localhost:${PORT}`);
});