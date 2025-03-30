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
function getAwsConfig(req) {
  const isDoctor = req.headers["x-role"] === "doctor";

  return {
    region: process.env.AWS_REGION || "us-east-2",
    accessKeyId: isDoctor
      ? process.env.AWS_ACCESS_KEY_ID_DOCTOR
      : process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: isDoctor
      ? process.env.AWS_SECRET_ACCESS_KEY_DOCTOR
      : process.env.AWS_SECRET_ACCESS_KEY,
  };
}
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
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const formattedTimestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const recordID = `XRAY#${formattedTimestamp}`;
    const params = {
      TableName: TABLE_NAME,
      Item: {
        PatientID: userSub,
        RecordID: recordID,
        Prediction: prediction,
        FileName: file.originalname,
        Timestamp: formattedTimestamp,
      },
    };

    await dynamoDB.put(params).promise();

    // Respond to the frontend with the prediction result
    res.json({ prediction, formattedTimestamp });

  } catch (error) {
    console.error("Error processing X-Ray:", error);
    res.status(500).json({ error: "Failed to analyze the X-ray", details: error.message });
  } finally {
    // Clean up the temporary file
    const unlinkAsync = promisify(fs.unlink);
    await unlinkAsync(file.path);
  }
});
// ====================
// Doctor Routes Middleware
// ====================
function requireDoctor(req, res, next) {
  if (req.headers["x-role"] === "doctor") {
    req.user.role = "doctor";
    return next();
  }
  return res.status(403).json({ error: "Access denied: Doctor role required" });
}

// ====================
// Get Aggregated Patient Data (for Doctor Dashboard)
// This endpoint scans the entire table and groups items by PatientID.
// It groups the PROFILE item, active prescriptions (PRE#), recent records (REC#), and Xray records (XRAY#)
// ====================
app.get("/all-aggregated", requireDoctor, async (req, res) => {
  const params = {
    TableName: TABLE_NAME,
  };

  try {
    const data = await dynamoDB.scan(params).promise();
    const items = data.Items || [];
    
    // Group items by PatientID
    const aggregated = {};
    items.forEach((item) => {
      const pid = item.PatientID;

      // Ensure only patients with a valid username are included
      if (item.RecordID === "PROFILE" && (!item.Username || item.Username === "N/A")) {
        return; // Skip this profile if Username is missing or "N/A"
      }

      if (!aggregated[pid]) {
        aggregated[pid] = {
          PatientID: pid,
          profile: null,
          activePrescriptions: [],
          recentRecords: [],
          xrayRecords: [],
        };
      }

      if (item.RecordID === "PROFILE") {
        aggregated[pid].profile = item;
      } else if (item.RecordID.startsWith("PRE#")) {
        aggregated[pid].activePrescriptions.push(item);
      } else if (item.RecordID.startsWith("REC#")) {
        aggregated[pid].recentRecords.push(item);
      } else if (item.RecordID.startsWith("XRAY#")) {
        aggregated[pid].xrayRecords.push(item);
      }
    });

    // Convert aggregated object to an array
    const result = Object.values(aggregated);

    // 🚀 Final filtering: Remove entire patients if their profile is missing (i.e., they had "N/A" username)
    const filteredResult = result.filter((patient) => patient.profile !== null);

    res.json(filteredResult);
  } catch (error) {
    console.error("Error aggregating data:", error);
    res.status(500).json({ error: "Error aggregating data", details: error.message });
  }
});

// ====================
// Add a New Patient Profile (for Doctor Dashboard)
// ====================
app.post("/add-patient", requireDoctor, async (req, res) => {
  const { PatientID, name, age, bloodType, weight } = req.body;
  
  if (!PatientID || !name || !age || !bloodType || !weight) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  const paramsCheck = {
    TableName: TABLE_NAME,
    Key: {
      PatientID,
      RecordID: "PROFILE",
    },
  };

  try {
    const existing = await dynamoDB.get(paramsCheck).promise();
    if (existing.Item) {
      return res.status(409).json({ error: "Patient already exists" });
    }
    
    const paramsPut = {
      TableName: TABLE_NAME,
      Item: {
        PatientID,
        RecordID: "PROFILE",
        name,
        age,
        bloodType,
        weight,
      },
    };

    await dynamoDB.put(paramsPut).promise();
    res.json({ message: "Patient added successfully", patient: paramsPut.Item });
  } catch (error) {
    console.error("Error adding patient:", error);
    res.status(500).json({ error: "Error adding patient", details: error.message });
  }
});

// ====================
// Overwrite a Patient Profile (for Doctor Dashboard)
// This endpoint completely replaces the PROFILE item with the new data.
// ====================
app.put("/update-patient", requireDoctor, async (req, res) => {
  console.log("Received update payload:", JSON.stringify(req.body, null, 2));
  const { PatientID, FullName, Age, BloodType, Weight, Username, activePrescriptions, recentRecords, xrayRecords } = req.body;
  
  if (!PatientID || !FullName || !Age || !BloodType || !Weight || !Username) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  // Ensure that the arrays are actual arrays; if not, default them to empty arrays.
  const item = {
    PatientID,
    RecordID: "PROFILE",
    FullName,
    Age,
    BloodType,
    Weight,
    Username,
    activePrescriptions: Array.isArray(activePrescriptions) ? activePrescriptions : [],
    recentRecords: Array.isArray(recentRecords) ? recentRecords : [],
    xrayRecords: Array.isArray(xrayRecords) ? xrayRecords : []
  };

  console.log("New item to put:", JSON.stringify(item, null, 2));
  const params = {
    TableName: TABLE_NAME,
    Item: item
  };

  try {
    await dynamoDB.put(params).promise();
    res.json({ message: "Patient updated successfully", patient: item });
  } catch (error) {
    console.error("Error updating patient:", error);
    res.status(500).json({ error: "Error updating patient", details: error.message });
  }
});


// ====================
// Delete a Patient Profile (for Doctor Dashboard)
// ====================
app.delete("/delete-patient/:PatientID", requireDoctor, async (req, res) => {
  const { PatientID } = req.params;
  const params = {
    TableName: TABLE_NAME,
    Key: {
      PatientID,
      RecordID: "PROFILE",
    },
  };

  try {
    await dynamoDB.delete(params).promise();
    res.json({ message: "Patient profile deleted successfully" });
  } catch (error) {
    console.error("Error deleting patient profile:", error);
    res.status(500).json({ error: "Error deleting patient", details: error.message });
  }
});

// ====================
// Add a new prescription record (for Doctor Dashboard)
// ====================
app.post("/add-prescription", requireDoctor, async (req, res) => {
  // Expect: { PatientID, Name, Dosage }
  const { PatientID, Name, Dosage } = req.body;
  if (!PatientID || !Name || !Dosage) {
    return res.status(400).json({ error: "Missing required fields: PatientID, Name, Dosage" });
  }
  const timestamp = Date.now();
  const recordID = `PRE#${timestamp}`;
  const params = {
    TableName: TABLE_NAME,
    Item: {
      PatientID,
      RecordID: recordID,
      Name,
      Dosage,
      Timestamp: timestamp
    }
  };
  try {
    await dynamoDB.put(params).promise();
    res.json({ message: "Prescription added successfully", prescription: params.Item });
  } catch (error) {
    console.error("Error adding prescription:", error);
    res.status(500).json({ error: "Error adding prescription", details: error.message });
  }
});

// ====================
// Add a new record (for Doctor Dashboard)
// ====================
app.post("/add-record", requireDoctor, async (req, res) => {
  // Expect: { PatientID, Diagnosis, Date }
  const { PatientID, Diagnosis, Date } = req.body;
  if (!PatientID || !Diagnosis || !Date) {
    return res.status(400).json({ error: "Missing required fields: PatientID, Diagnosis, Date" });
  }
  // You can use Date or a timestamp. Here we use Date string directly:
  const recordID = `REC#${Date}`;
  const params = {
    TableName: TABLE_NAME,
    Item: {
      PatientID,
      RecordID: recordID,
      Diagnosis,
      Date
    }
  };
  try {
    await dynamoDB.put(params).promise();
    res.json({ message: "Record added successfully", record: params.Item });
  } catch (error) {
    console.error("Error adding record:", error);
    res.status(500).json({ error: "Error adding record", details: error.message });
  }
});

app.delete("/delete-item/:recordID", requireDoctor, async (req, res) => {
  const { recordID } = req.params;
  const patientID = req.query["x-patient-id"];

  if (!patientID) {
    return res.status(400).json({ error: "Missing patient ID" });
  }

  const params = {
    TableName: TABLE_NAME,
    Key: {
      PatientID: patientID,
      RecordID: recordID,
    },
  };

  try {
    await dynamoDB.delete(params).promise();
    res.json({ message: `Item ${recordID} deleted successfully` });
  } catch (error) {
    console.error("Error deleting item:", error);
    res.status(500).json({ error: "Failed to delete item", details: error.message });
  }
});


app.put("/update-prescription", requireDoctor, async (req, res) => {
  const { PatientID, RecordID, Name, Dosage } = req.body;
  
  if (!PatientID || !RecordID || !Name || !Dosage) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const params = {
    TableName: TABLE_NAME,
    Key: { PatientID, RecordID },
    UpdateExpression: "set #n = :Name, Dosage = :Dosage",
    ExpressionAttributeNames: {
      "#n": "Name"
    },
    ExpressionAttributeValues: {
      ":Name": Name,
      ":Dosage": Dosage,
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const result = await dynamoDB.update(params).promise();
    res.json({ message: "Prescription updated successfully", prescription: result.Attributes });
  } catch (error) {
    console.error("Error updating prescription:", error);
    res.status(500).json({ error: "Failed to update prescription", details: error.message });
  }
});


app.put("/update-record", requireDoctor, async (req, res) => {
  const { PatientID, RecordID, Diagnosis, Date } = req.body;
  
  if (!PatientID || !RecordID || !Diagnosis || !Date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const params = {
    TableName: TABLE_NAME,
    Key: { PatientID, RecordID },
    UpdateExpression: "set Diagnosis = :Diagnosis, #d = :Date",
    ExpressionAttributeNames: {
      "#d": "Date"
    },
    ExpressionAttributeValues: {
      ":Diagnosis": Diagnosis,
      ":Date": Date,
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const result = await dynamoDB.update(params).promise();
    res.json({ message: "Record updated successfully", record: result.Attributes });
  } catch (error) {
    console.error("Error updating record:", error);
    res.status(500).json({ error: "Failed to update record", details: error.message });
  }
});


app.put("/update-xray", requireDoctor, async (req, res) => {
  const { PatientID, RecordID, FileName, Prediction } = req.body;
  
  if (!PatientID || !RecordID || !FileName || !Prediction) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const params = {
    TableName: TABLE_NAME,
    Key: { PatientID, RecordID },
    UpdateExpression: "set FileName = :FileName, Prediction = :Prediction",
    ExpressionAttributeValues: {
      ":FileName": FileName,
      ":Prediction": Prediction,
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const result = await dynamoDB.update(params).promise();
    res.json({ message: "X-ray updated successfully", xray: result.Attributes });
  } catch (error) {
    console.error("Error updating x-ray:", error);
    res.status(500).json({ error: "Failed to update x-ray", details: error.message });
  }
});

const cognito = new AWS.CognitoIdentityServiceProvider();

app.post("/create-patient", requireDoctor, async (req, res) => {
  const { FullName, Age, BloodType, Weight, Email, Username } = req.body;

  if (!FullName || !Age || !BloodType || !Weight || !Email || !Username) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // ✅ Use doctor-specific AWS credentials
    const doctorAwsConfig = getAwsConfig(req);
    const cognito = new AWS.CognitoIdentityServiceProvider(doctorAwsConfig);
    const dynamoDB = new AWS.DynamoDB.DocumentClient(doctorAwsConfig);

    // 🔹 Step 1: Create user in Cognito
    const createUserParams = {
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
      Username: Username,
      UserAttributes: [
        { Name: "email", Value: Email },
        { Name: "name", Value: FullName },
      ],
      TemporaryPassword: "TempPass123!",
      //MessageAction: "SUPPRESS",
    };

    const cognitoResponse = await cognito.adminCreateUser(createUserParams).promise();

    // 🔹 Step 2: Extract user `sub` from Cognito response
    const subAttribute = cognitoResponse.User.Attributes.find(attr => attr.Name === "sub");
    if (!subAttribute) {
      throw new Error("User sub attribute not found");
    }
    const patientSub = subAttribute.Value;

    // 🔹 Step 3: Store patient details in DynamoDB
    const dbParams = {
      TableName: TABLE_NAME,
      Item: {
        PatientID: patientSub,
        RecordID: "PROFILE",
        FullName,
        Age,
        BloodType,
        Weight,
        Username,
        Email,
        activePrescriptions: [],
        recentRecords: [],
        xrayRecords: [],
      },
    };

    await dynamoDB.put(dbParams).promise();

    res.json({
      message: "Patient created successfully",
      patient: dbParams.Item,
      cognitoUser: cognitoResponse.User,
    });
  } catch (error) {
    console.error("Error creating patient:", error);
    res.status(500).json({ error: "Error creating patient", details: error.message });
  }
});


// Start Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
