#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Set ROOT to two folders up from the script's directory
ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

SOURCE_FILE="$ROOT/resources/repair-views/repair.html"
# Loop through each directory in $ROOT/drivers/*
for dir in "$ROOT/drivers/"*; do
  if [ -d "$dir" ]; then  # Check if $dir is a directory
    # Create the pair directory if it doesn't exist
    mkdir -p "$dir/repair"
    # Copy the file to the pair directory
    cp $SOURCE_FILE "$dir/repair/"
  fi
done