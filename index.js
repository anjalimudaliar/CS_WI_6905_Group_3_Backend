require("dotenv").config();
const express = require("express");
const AWS = require("aws-sdk");
const multer = require("multer");
const cors = require("cors");
const { promisify } = require("util");
const FormData = require("form-data");
const axios = require("axios");
const fs = require("fs");
const app = express();
const port = process.env.PORT || 5000;
// Enable CORS
app.use(cors());
app.use(express.json());
const upload = multer({ dest: "uploads/" });
// AWS Configuration
const awsConfig = {
  region: process.env.AWS_REGION || "us-east-2",
};
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  awsConfig.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
}
AWS.config.update(awsConfig);

// DynamoDB
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "MedicalRecords";

// S3 for file uploads
const s3 = new AWS.S3();
//const upload = multer({ storage: multer.memoryStorage() });

// ==========
// Middleware to get userSub
// In production, replace this with JWT verification to set req.user.sub
// ==========
function mockAuth(req, res, next) {
  // For local testing, you might pass the Cognito sub in a header: x-sub
  // e.g. '617ba5b0-9091-7073-b7a8-fca1a6a80ee1'
  req.user = { sub: req.headers["x-sub"] || "demo-sub" };
  next();
}
app.use(mockAuth);

// ==========
// Health Check
// ==========
app.get("/", (req, res) => {
  res.json({ message: "Node.js Backend is Running! 🚀" });
});

// ==========
// Get Profile
// ==========
app.get("/profile", async (req, res) => {
  const userSub = req.user.sub;

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PatientID: userSub,
      RecordID: "PROFILE", // we treat this as the "profile" item
    },
  };

  try {
    const data = await dynamoDB.get(params).promise();
    if (!data.Item) {
      return res.status(404).json({ error: "Profile not found for this user." });
    }
    res.json(data.Item);
  } catch (error) {
    console.error("DynamoDB Fetch Error:", error);
    res.status(500).json({ error: "Error fetching profile", details: error.message });
  }
});

// ==========
// Get All Medical Records (Sort Key starts with "REC#")
// ==========
app.get("/records", async (req, res) => {
  const userSub = req.user.sub;

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "PatientID = :sub AND begins_with(RecordID, :rec)",
    ExpressionAttributeValues: {
      ":sub": userSub,
      ":rec": "REC#",
    },
  };

  try {
    const data = await dynamoDB.query(params).promise();
    res.json(data.Items || []);
  } catch (error) {
    console.error("DynamoDB Query Error:", error);
    res.status(500).json({ error: "Error fetching records", details: error.message });
  }
});

// ==========
// Get a Single Record by RecordID
// e.g. GET /records/REC#2025-02-10
// ==========
app.get("/records/:recordID", async (req, res) => {
  const userSub = req.user.sub;
  const { recordID } = req.params;

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PatientID: userSub,
      RecordID: recordID,
    },
  };

  try {
    const data = await dynamoDB.get(params).promise();
    if (!data.Item) {
      return res.status(404).json({ error: "Record not found." });
    }
    res.json(data.Item);
  } catch (error) {
    console.error("DynamoDB Fetch Error:", error);
    res.status(500).json({ error: "Error fetching record", details: error.message });
  }
});

// ==========
// Create a New Record
// e.g. POST /records
// Body: { recordID: "REC#2025-03-20", Diagnosis: "X-Ray", Date: "2025-03-20" }
// ==========
app.post("/records", async (req, res) => {
  const userSub = req.user.sub;
  const { recordID, Diagnosis, Date } = req.body;

  if (!recordID || !Diagnosis || !Date) {
    return res.status(400).json({ error: "Missing required fields: recordID, Diagnosis, Date" });
  }

  const params = {
    TableName: TABLE_NAME,
    Item: {
      PatientID: userSub,
      RecordID: recordID,
      Diagnosis,
      Date,
    },
    ConditionExpression: "attribute_not_exists(PatientID) AND attribute_not_exists(RecordID)",
  };

  try {
    await dynamoDB.put(params).promise();
    res.json({ message: "Medical record created successfully!", data: params.Item });
  } catch (error) {
    console.error("DynamoDB Put Error:", error);
    res.status(500).json({ error: "Error creating record", details: error.message });
  }
});

// ==========
// Upload X-ray to S3
// (remains mostly the same)
// ==========
app.post("/upload-xray", upload.single("xray"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const timestamp = Date.now();
  const filename = `${timestamp}-${req.file.originalname}`;
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: filename,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
  };

  try {
    const uploadResult = await s3.upload(params).promise();
    res.json({
      message: "X-Ray uploaded successfully!",
      url: uploadResult.Location,
      fileName: filename,
      timestamp: timestamp,
    });
  } catch (error) {
    console.error("S3 Upload Error:", error);
    res.status(500).json({ error: "Upload failed", details: error.message });
  }
});

// ==========
// Delete a Record
// e.g. DELETE /records/REC#2025-02-10
// ==========
app.delete("/records/:recordID", async (req, res) => {
  const userSub = req.user.sub;
  const { recordID } = req.params;

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PatientID: userSub,
      RecordID: recordID,
    },
  };

  try {
    await dynamoDB.delete(params).promise();
    res.json({ message: "Medical record deleted successfully" });
  } catch (error) {
    console.error("DynamoDB Delete Error:", error);
    res.status(500).json({ error: "Error deleting record", details: error.message });
  }
});

// ==========
// OPTIONAL: Get All Items (Profile + Records + etc.)
// If you want to fetch everything for the user in one query
// ==========
app.get("/all-items", async (req, res) => {
  const userSub = req.user.sub;
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "PatientID = :sub",
    ExpressionAttributeValues: {
      ":sub": userSub,
    },
  };

  try {
    const data = await dynamoDB.query(params).promise();
    res.json(data.Items || []);
  } catch (error) {
    console.error("DynamoDB Query Error:", error);
    res.status(500).json({ error: "Error fetching all items", details: error.message });
  }
});

// =====================================
// Get Active Prescriptions (Sort Key starts with "PRE#")
// =====================================
app.get("/prescriptions", async (req, res) => {
  const userSub = req.user.sub;
  
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "PatientID = :sub AND begins_with(RecordID, :pre)",
    ExpressionAttributeValues: {
      ":sub": userSub,
      ":pre": "PRE#"
    },
  };

  try {
    const data = await dynamoDB.query(params).promise();
    res.json(data.Items || []);
  } catch (error) {
    console.error("DynamoDB Query Error for prescriptions:", error);
    res.status(500).json({ error: "Error fetching prescriptions", details: error.message });
  }
});

// ==========
// Store X-Ray Prediction in DynamoDB
// ==========
app.post("/analyze-xray", upload.single("file"), async (req, res) => {
  const file = req.file;
  const userSub = req.headers["x-sub"]; // Retrieve user identifier from headers

  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    // Prepare the file for forwarding
    const formData = new FormData();
    formData.append("file", fs.createReadStream(file.path), file.originalname);

    // Forward the file to the classifier API
    const classifierResponse = await axios.post(
      "http://medportal-lb-1742379571.us-east-2.elb.amazonaws.com:8000/classifier/predict",
      formData,
      { headers: formData.getHeaders() }
    );

    const prediction = classifierResponse.data.prediction;
    const timestamp = Date.now();

    // Store the prediction result in your database
    const recordID = `XRAY#${timestamp}`;
    const params = {
      TableName: TABLE_NAME,
      Item: {
        PatientID: userSub,
        RecordID: recordID,
        Prediction: prediction,
        FileName: file.originalname,
        Timestamp: timestamp,
      },
    };

    await dynamoDB.put(params).promise();

    // Respond to the frontend with the prediction result
    res.json({ prediction, timestamp });

  } catch (error) {
    console.error("Error processing X-Ray:", error);
    res.status(500).json({ error: "Failed to analyze the X-ray", details: error.message });
  } finally {
    // Clean up the temporary file
    const unlinkAsync = promisify(fs.unlink);
    await unlinkAsync(file.path);
  }
});


// Start Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
