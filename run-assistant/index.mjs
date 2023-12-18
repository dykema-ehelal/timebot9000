import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { OpenAI } from "openai";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

// Initialize OpenAI and DynamoDB DocumentClient and
const oai = new OpenAI(process.env.OPENAI_API_KEY);
const ddb = DynamoDBDocument.from(new DynamoDB({ region: "us-east-2" }));

export const handler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName !== "INSERT") continue;

    const recordImage = record.dynamodb.NewImage;
    const connectionId = recordImage.ConnectionId.S;
    const timestamp = Number(recordImage.Timestamp.N);
    const userJson = recordImage.ReceivedJson.S;
    const userMessage = recordImage.UserMessage.S;

    try {
      await processRecord(connectionId, timestamp, userJson, userMessage);
    } catch (error) {
      await handleError(connectionId, timestamp, error, userJson);
      return response(500, error.message);
    }
  }

  return response(200, "Processing Complete");
};

const processRecord = async (
  connectionId,
  timestamp,
  userJson,
  userMessage
) => {
  const runResponse = await runStarter(userMessage);
  let runId = runResponse.id;
  let threadId = runResponse.thread_id;

  await logUpdate(connectionId, timestamp, runId, threadId);
  console.info(`Run Response: ${JSON.stringify(runResponse, null, 2)}`);
  await monitorRun(runResponse, connectionId, timestamp, userJson);
};

const monitorRun = async (runResponse, connectionId, timestamp) => {
  const startTime = Date.now();
  let runStatus = runResponse.status;
  let runId = runResponse.id;
  let threadId = runResponse.thread_id;

  while (!["completed", "failed"].includes(runStatus)) {
    if (Date.now() - startTime > 120000) {
      throw new Error("OpenAI Run Timed Out");
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
    const statusResponse = await runStatusChecker(threadId, runId);
    console.info(`Run Status Check: ${JSON.stringify(statusResponse)}`);
    runStatus = statusResponse.status;
  }

  if (runStatus === "completed") {
    console.info("In Run Status Complete");
    const assistantMessage = await runMessageList(threadId);
    if (!assistantMessage)
      throw new Error("Failed to retrieve assistant message");
    await logFinish(connectionId, timestamp, assistantMessage);
    await socketMessage(connectionId, {
      timeBotStatus: "Complete",
      message: assistantMessage,
    });
  } else {
    throw new Error(`Run ended with status: ${runStatus}`);
  }
};

const handleError = async (connectionId, timestamp, error, userJson) => {
  console.error(error);
  await logError(
    connectionId,
    error.message,
    undefined,
    undefined,
    undefined,
    userJson
  );
  await logFinish(connectionId, timestamp);
  await socketMessage(connectionId, {
    timeBotStatus: "Error",
    message: error.message,
  });
};

const response = (statusCode, message) => ({
  statusCode,
  body: JSON.stringify({ message }),
  headers: { "Content-Type": "application/json" },
});

async function logError(
  connectionId,
  error,
  threadId,
  runId,
  runStatus,
  receivedJson
) {
  const logParams = {
    TableName: "timeBot9000-database",
    Item: {
      ConnectionId: connectionId,
      Timestamp: Date.now(),
      Error: error.message,
      ThreadId: threadId || "N/A",
      RunId: runId || "N/A",
      RunStatus: runStatus || "unknown",
      InteractionType: "Error",
      ReceivedJson: receivedJson || "N/A",
    },
  };
  await ddb.put(logParams);
}

async function logUpdate(connectionId, timestamp, runId, threadId) {
  const updateParams = {
    TableName: "timeBot9000-database",
    Key: {
      ConnectionId: connectionId,
      Timestamp: timestamp,
    },
    UpdateExpression:
      "SET TimeBotStatus = :newStatus, " +
      "RunId = :runId, " +
      "RunStatus = :runStatus, " +
      "ThreadId = :threadId",
    ExpressionAttributeValues: {
      ":newStatus": "Processing",
      ":runStatus": "processing",
      ":runId": runId,
      ":threadId": threadId,
    },
    ReturnValues: "NONE",
  };
  await ddb.update(updateParams);
}

async function logFinish(connectionId, timestamp, assistantMessage) {
  const updateParams = {
    TableName: "timeBot9000-database",
    Key: {
      ConnectionId: connectionId,
      Timestamp: timestamp,
    },
    UpdateExpression:
      "SET TimeBotStatus = :newStatus, " +
      "AssistantMessage = :assistantMessage, " +
      "RunStatus = :runStatus",
    ExpressionAttributeValues: {
      ":newStatus": assistantMessage ? "Complete" : "Error",
      ":assistantMessage": assistantMessage || "N/A",
      ":runStatus": assistantMessage ? "complete" : "failed",
    },
    ReturnValues: "NONE",
  };
  await ddb.update(updateParams);
}

async function runStarter(userMessage) {
  const assistantId = process.env.ASSISTANT_ID;
  const thread = {
    messages: [{ role: "user", content: userMessage }],
  };
  return await oai.beta.threads.createAndRun({
    assistant_id: assistantId,
    thread: thread,
  });
}

async function runStatusChecker(threadId, runId) {
  return await oai.beta.threads.runs.retrieve(threadId, runId);
}

async function runMessageList(threadId) {
  const messageResponse = await oai.beta.threads.messages.list(threadId);
  console.info(`Run Mesasge List: ${JSON.stringify(messageResponse)}`);
  const assistantMessage = messageResponse.data.find(
    (message) => message.role === "assistant"
  );

  // Check if the assistantMessage and its content are defined
  if (
    assistantMessage &&
    assistantMessage.content &&
    assistantMessage.content.length > 0 &&
    assistantMessage.content[0].type === "text"
  ) {
    return assistantMessage.content[0].text.value;
  } else {
    return null;
  }
}

async function socketMessage(connectionId, messagePayload) {
  // Initialize the AWS API Gateway Management API Client
  const callbackUrl = process.env.CALLBACK_URL;
  const aac = new ApiGatewayManagementApiClient({ endpoint: callbackUrl });

  let socketResponse, socketCommand;
  socketResponse = JSON.stringify(messagePayload);
  socketCommand = new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: socketResponse,
  });

  await aac.send(socketCommand);
}
