#!/bin/zsh

# Create the document resource type with simplified relations
curl -X POST 'https://api.workos.com/fga/v1/resource-types' \
-H "Authorization: Bearer $WORKOS_API_KEY" \
-H 'Content-Type: application/json' \
-d '{
  "type": "document",
  "relations": {
    "owner": {},
    "viewer": {
      "inherit_if": "owner"
    }
  }
}'

# Create the user resource type
curl -X POST 'https://api.workos.com/fga/v1/resource-types' \
-H "Authorization: Bearer $WORKOS_API_KEY" \
-H 'Content-Type: application/json' \
-d '{
  "type": "user",
  "relations": {}
}'
