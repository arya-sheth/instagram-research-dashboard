# Use the official Microsoft Playwright image as a base
# This image comes with all necessary system dependencies for Chromium
FROM mcr.microsoft.com/playwright:v1.50.1-jammy

# Set working directory
WORKDIR /app

# Copy package files from the api directory
COPY apps/api/package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code from the api directory
COPY apps/api/ .

# Build the NestJS application
RUN npm run build

# Install Chromium (specifically for the playwright version in package.json)
RUN npx playwright install chromium

# Expose the port the app runs on
EXPOSE 4000

# Start the application
CMD ["npm", "run", "start"]
