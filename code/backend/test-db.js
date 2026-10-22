//to check if mongodb connection is successful or not
//uses .env file to get the connection string
require("dotenv").config();
const mongoose = require("mongoose");

mongoose
    .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
    .then(async () => {
        await mongoose.connection.db.admin().ping();
        console.log("Connected to Atlas and ping succeeded");
        process.exit(0);
    })
    .catch((err) => {
        console.error("Connection failed:", err.message);
        process.exit(1);
    });