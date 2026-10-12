#!/bin/sh
set -eu

images_dir=/workspace/execution-service/Runner/RunnerImages

docker build -t syncode-runner-node -f "$images_dir/Dockerfile.node" "$images_dir"
docker build -t syncode-runner-python -f "$images_dir/Dockerfile.python" "$images_dir"
docker build -t syncode-runner-dotnet -f "$images_dir/Dockerfile.dotnet" "$images_dir"
docker build -t syncode-runner-c --build-arg RUNNER_RUNTIME=c -f "$images_dir/Dockerfile.native" "$images_dir"
docker build -t syncode-runner-cpp --build-arg RUNNER_RUNTIME=cpp -f "$images_dir/Dockerfile.native" "$images_dir"
docker build -t syncode-runner-rust -f "$images_dir/Dockerfile.rust" "$images_dir"
docker build -t syncode-runner-java -f "$images_dir/Dockerfile.java" "$images_dir"
docker build -t syncode-runner-bash -f "$images_dir/Dockerfile.bash" "$images_dir"
