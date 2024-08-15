@echo off
REM Build the Docker image
docker build -t dynamicboard .

REM Save the Docker image with a timestamp
set TIMESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
docker save -o images\dynamicboard_%TIMESTAMP%.tar dynamicboard
