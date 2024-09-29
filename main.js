import express from 'express';
import bodyParser from 'body-parser';
import { CloudWatchLogsClient, CreateLogStreamCommand, PutLogEventsCommand, DescribeLogStreamsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { v4 as uuidv4 } from 'uuid';  // Use UUID for unique log stream names

const app = express();
const cloudwatchLogs = new CloudWatchLogsClient({ region: 'ap-south-1' }); // Set your AWS region
const logGroupName = '/app/api-logs'; // CloudWatch Log Group

app.use(bodyParser.json());

// Function to create a unique log stream for each request
async function createLogStream(logStreamName) {
    try {
        const command = new CreateLogStreamCommand({ logGroupName, logStreamName });
        await cloudwatchLogs.send(command);
    } catch (err) {
        console.error('Error creating log stream:', err);
    }
}

// Function to log request/response to CloudWatch
async function logToCloudWatch(logStreamName, message) {
    const logEventParams = {
        logEvents: [
            {
                message: JSON.stringify(message),
                timestamp: new Date().getTime(),
            },
        ],
        logGroupName,
        logStreamName,
    };

    try {
        const describeCommand = new DescribeLogStreamsCommand({ logGroupName, logStreamNamePrefix: logStreamName });
        const data = await cloudwatchLogs.send(describeCommand);

        if (data.logStreams.length > 0 && data.logStreams[0].uploadSequenceToken) {
            logEventParams.sequenceToken = data.logStreams[0].uploadSequenceToken;
        }

        const putCommand = new PutLogEventsCommand(logEventParams);
        await cloudwatchLogs.send(putCommand);
    } catch (err) {
        console.error('Error logging to CloudWatch:', err);
    }
}

// Middleware to log request and response
app.use(async (req, res, next) => {
    const logStreamName = `api-log-stream-${uuidv4()}`; // Unique log stream for each request
    await createLogStream(logStreamName); // Create the log stream

    // Store start time to calculate response time later
    const startTime = new Date();

    // Temporarily hold the default send method to capture the response body
    const originalSend = res.send;

    res.send = async function (body) {
        res.body = body; // Save response body to log later
        originalSend.apply(res, arguments); // Call original send method

        // Log the response after it's sent
        const logEntry = {
            method: req.method,
            path: req.path,
            headers: req.headers,
            body: req.body,
            timestamp: startTime.toISOString(),
            responseTime: `${new Date() - startTime}ms`,
            response: {
                statusCode: res.statusCode,
                headers: res.getHeaders(),
                body: res.body,
            }
        };
        await logToCloudWatch(logStreamName, logEntry);
    };

    next();
});

app.get('/api/hello', async (req, res) => {
    const response = { message: "cloudwatch testing " };

    // Send the response (logging happens automatically in middleware)
    res.json(response);
});

app.post('/api/data', async (req, res) => {
    const dataRecieved = req.body;
    res.json({
        status: 'success',
        message: 'OK',
        receivedData: dataRecieved,
    });
});

app.listen(3000, async () => {
    console.log('Server is running on port 3000');
});
