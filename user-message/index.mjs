import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

// Initialize DynamoDB DocumentClient
const ddb = DynamoDBDocument.from(new DynamoDB({ region: "us-east-2" }));

export const handler = async (event, context) => {
  // Extract connectionId and WebSocket endpoint info
  const { connectionId, domainName, stage } = event.requestContext;
  const callbackUrl = `https://${domainName}/${stage}`;

  // Initialize the AWS API Gateway Management API Client
  const aac = new ApiGatewayManagementApiClient({ endpoint: callbackUrl });

  try {
    // Validate event.body before parsing
    if (!event.body || typeof event.body !== "string") {
      throw new Error("Invalid or missing event body");
    }

    // Parse the event body
    const parsedBody = JSON.parse(event.body);

    // Check if the parsed object has the 'message' key and if it's a string
    if (
      !Object.hasOwn(parsedBody, "message") ||
      typeof parsedBody.message !== "string"
    ) {
      throw new Error("Missing or invalid 'message' in event body");
    }

    const userMessage = parsedBody.message;
    console.log("Received userMessage:", userMessage);

    // Construct response for the WebSocket client
    const socketResponse = JSON.stringify({
      timeBotStatus: "UserMessageReceived",
      message: userMessage,
    });

    // Send the response to the WebSocket client
    await aac.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: socketResponse,
      })
    );

    // Log successful receipt of user message
    await logInteraction(connectionId, userMessage, event.body);
    return { statusCode: 200 };
  } catch (error) {
    console.error("Error occurred:", error);

    // Attempt to log the error
    try {
      await logError(connectionId, "UserMessageHandling", error, event.body);
    } catch (loggingError) {
      console.error("Failed to log error:", loggingError);
      return createErrorResponse(
        500,
        `Server Error (Logging): ${loggingError.message}`
      );
    }

    // Attempt to notify the user of error
    try {
      const socketResponse = JSON.stringify({
        timeBotStatus: "UserMessageFailed",
        message: event.body,
      });

      await aac.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: socketResponse,
        })
      );
    } catch (sendingError) {
      console.error("Error occurred:", sendingError);
      return createErrorResponse(
        500,
        `Server Error (Websocket): ${sendingError.message}`
      );
    }

    // Construct and return the appropriate HTTP response
    return error instanceof SyntaxError
      ? createErrorResponse(400, "Bad Request: Malformed JSON", error.message)
      : createErrorResponse(500, "Server Error", error.message);
  }
};

function createErrorResponse(statusCode, statusMessage, errorDetail = "") {
  return {
    statusCode,
    body: JSON.stringify({
      statusMessage,
      errorDetail,
    }),
    headers: { "Content-Type": "application/json" },
  };
}

async function logError(connectionId, errorType, error, receivedJson) {
  await ddb.put({
    TableName: "timeBot9000-database",
    Item: {
      ConnectionId: connectionId,
      Timestamp: Date.now(),
      InteractionType: `Error: ${errorType}`,
      Error: error.message,
      ErrorStack: error.stack, // Log the stack trace for more detailed debugging
      ReceivedJson: receivedJson,
      TimeBotStatus: "Error",
    },
  });
}

async function logInteraction(connectionId, userMessage, receivedJson) {
  await ddb.put({
    TableName: "timeBot9000-database",
    Item: {
      ConnectionId: connectionId,
      Timestamp: Date.now(),
      UserMessage: userMessage,
      AssistantMessage: "",
      ThreadId: "",
      RunId: "",
      RunStatus: "not-started",
      InteractionType: "SupportRequest",
      TimeBotStatus: "UserMessageReceived",
      ReceivedJson: receivedJson,
    },
  });
}
