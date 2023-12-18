import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DynamoDB } from "@aws-sdk/client-dynamodb";


// Initialize the DynamoDB DocumentClient
const ddb = DynamoDBDocument.from(new DynamoDB({ region: "us-east-2" }));

export const handler = async (event, context) => {
  // Grab request connectionId for logs
  const connectionId = event.requestContext.connectionId;

  // Construct parameters to log the operation in the DynamoDB table with the connectionId
  const putParams = {
    TableName: "timeBot9000-database",
    Item: {
      ConnectionId: connectionId,
      Timestamp: Date.now(),
      InteractionType: "Disconnection",
    },
  };

  try {
    await ddb.put(putParams);

    // Return a JSON object in the body
    return { statusCode: 200 };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        statusMessage: "Failed to disconnect gracefully.",
        errorDetail: err.message,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  }
};
