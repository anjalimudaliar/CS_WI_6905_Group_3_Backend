CS_WI_6905_Group_3_Backend

API Documentation: Medical Records Management System

Overview

The Medical Records Management System is a Node.js backend service that provides APIs for managing patient profiles, medical records, prescriptions, and X-ray analysis. The system integrates AWS services, including DynamoDB for data storage, S3 for file uploads, and Cognito for authentication.

Base URL

http://localhost:5000

Authentication

Users must include x-sub in the request headers to identify the patient.

Doctors must include x-role: doctor in the request headers to access restricted routes.

Endpoints

1. Health Check

GET /

Description: Checks if the API is running.

Response:

{ "message": "Node.js Backend is Running! " }

2. Patient Profile Management

GET /profile

Description: Retrieves the profile of the authenticated user.

Response:

{ "PatientID": "123", "RecordID": "PROFILE", "name": "John Doe", "age": 30 }

POST /add-patient (Requires Doctor Access)

Description: Adds a new patient profile.

Request Body:

{ "PatientID": "123", "name": "John Doe", "age": 30, "bloodType": "O+", "weight": 75 }

Response:

{ "message": "Patient added successfully" }

PUT /update-patient (Requires Doctor Access)

Description: Updates a patient profile.

Request Body:

{ "PatientID": "123", "FullName": "John Doe", "Age": 31, "BloodType": "O+", "Weight": 75, "Username": "johndoe" }

Response:

{ "message": "Patient updated successfully" }

DELETE /delete-patient/:PatientID (Requires Doctor Access)

Description: Deletes a patient profile.

Response:

{ "message": "Patient profile deleted successfully" }

3. Medical Records Management

GET /records

Description: Retrieves all medical records for the authenticated user.

Response:

[ { "RecordID": "REC#2025-03-20", "Diagnosis": "X-Ray", "Date": "2025-03-20" } ]

GET /records/:recordID

Description: Retrieves a specific medical record.

Response:

{ "RecordID": "REC#2025-03-20", "Diagnosis": "X-Ray", "Date": "2025-03-20" }

POST /records

Description: Adds a new medical record.

Request Body:

{ "recordID": "REC#2025-03-20", "Diagnosis": "X-Ray", "Date": "2025-03-20" }

Response:

{ "message": "Medical record created successfully!" }

DELETE /records/:recordID

Description: Deletes a medical record.

Response:

{ "message": "Medical record deleted successfully" }

4. Prescription Management

GET /prescriptions

Description: Retrieves active prescriptions for the authenticated user.

Response:

[ { "RecordID": "PRE#1616556000", "Name": "Paracetamol", "Dosage": "500mg" } ]

POST /add-prescription (Requires Doctor Access)

Description: Adds a new prescription record.

Request Body:

{ "PatientID": "123", "Name": "Paracetamol", "Dosage": "500mg" }

Response:

{ "message": "Prescription added successfully" }

PUT /update-prescription (Requires Doctor Access)

Description: Updates a prescription record.

Request Body:

{ "PatientID": "123", "RecordID": "PRE#1616556000", "Name": "Ibuprofen", "Dosage": "400mg" }

Response:

{ "message": "Prescription updated successfully" }

5. X-Ray Management

POST /upload-xray

Description: Uploads an X-ray file to AWS S3.

Response:

{ "message": "X-Ray uploaded successfully!", "url": "s3://bucket/xray.jpg" }

POST /analyze-xray

Description: Uploads an X-ray and stores the AI-based analysis in DynamoDB.

Response:

{ "prediction": "Normal", "formattedTimestamp": "2025-03-29_14-35-20" }

PUT /update-xray (Requires Doctor Access)

Description: Updates an X-ray record.

Request Body:

{ "PatientID": "123", "RecordID": "XRAY#2025-03-29_14-35-20", "FileName": "xray.jpg", "Prediction": "Abnormal" }

Response:

{ "message": "X-ray updated successfully" }

6. Aggregated Patient Data

GET /all-aggregated (Requires Doctor Access)

Description: Retrieves all patients' data grouped by PatientID.

Response:

[ {
  "PatientID": "123",
  "profile": { "name": "John Doe", "age": 30 },
  "activePrescriptions": [],
  "recentRecords": [],
  "xrayRecords": []
} ]

7. Patient Creation via Cognito

POST /create-patient (Requires Doctor Access)

Description: Creates a new patient in AWS Cognito and stores the profile in DynamoDB.

Request Body:

{ "FullName": "John Doe", "Age": 30, "BloodType": "O+", "Weight": 75, "Email": "johndoe@example.com", "Username": "johndoe" }

Response:

{ "message": "Patient created successfully" }

Error Handling

All endpoints return errors in the following format:

{ "error": "Error message", "details": "Error details if available" }

Technologies Used

Node.js & Express: Backend framework

AWS DynamoDB: NoSQL database for patient records

AWS S3: Storage for X-ray files

AWS Cognito: Authentication and user management

Multer: File uploads

Axios: HTTP requests

FormData: Handling file uploads
