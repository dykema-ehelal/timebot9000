import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DynamoDB } from "@aws-sdk/client-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

// Initialize the DynamoDB DocumentClient
const ddb = DynamoDBDocument.from(new DynamoDB({ region: "us-east-2" }));

export const handler = async (event, context) => {
  // Grab request connectionId for the socket
  const connectionId = event.requestContext.connectionId;

  // Initialize the Aws API Gateway Management API Client
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const callbackUrl = `https://${domain}/${stage}`;
  const aac = new ApiGatewayManagementApiClient({ endpoint: callbackUrl });

  // Construct parameters to log the unsupported operation in the DynamoDB table
  const putParams = {
    TableName: "timeBot9000-database",
    Item: {
      ConnectionId: connectionId,
      Timestamp: Date.now(),
      Error: "Unrecognized route key: " + event.requestContext.routeKey,
      InteractionType: "Error",
    },
  };

  // Construct response body to send to the client
  const socketResponse = JSON.stringify({
    statusMessage: "Error",
    connectionId: connectionId,
    errorDetail: "Unsupported Route: " + event.requestContext.routeKey,
  });

  const socketCommand = new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: socketResponse,
  });

  try {
    await ddb.put(putParams);

    await aac.send(socketCommand);

    return { statusCode: 200 };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        statusMessage: "Unexpected Server Error.",
        errorDetail: err,
      }),
      headers: { "Content-Type": "application/json" },
    };
  }
};
