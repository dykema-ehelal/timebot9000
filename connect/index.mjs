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
      InteractionType: "Connection",
    },
  };

  try {
    await ddb.put(putParams);

    return { statusCode: 200 };
  } catch (err) {
    console.warn(err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        statusMessage: "Connection Error",
        errorDetail: err.message,
      }),
      headers: { "Content-Type": "application/json" },
    };
  }
};
