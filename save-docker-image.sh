#!/bin/sh
# Build the Docker image
docker build -t dynamicboard .

# Save the Docker image with a timestamp
TIMESTAMP=$(date +%Y%m%d%H%M%S)
docker save -o images/dynamicboard_$TIMESTAMP.tar dynamicboard
