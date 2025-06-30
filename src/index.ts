import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

app.listen(port, () => {
  console.log(`[server]: API running at http://localhost:${port}`);
});