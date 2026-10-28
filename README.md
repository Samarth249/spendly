# Spendly – Personal Finance Management System

## 1. Project Introduction

**Spendly** is a web-based personal finance management application designed to help users manage income, expenses, wallets, shared expenses, and repayments in one place. It provides a simple interface for recording financial transactions and reviewing financial activities.

The project aims to make everyday money management more organized, accessible, and convenient through a centralized application.

## 2. Problem Statement

Managing personal finances manually can be challenging because income, expenses, wallet balances, shared expenses, and repayments are often recorded in different places. This makes it difficult to maintain accurate records, monitor spending habits, track pending payments, and understand overall financial status.

Therefore, a centralized, user-friendly, and efficient solution is needed to simplify daily financial management.

## 3. Proposed Solution

Spendly provides a centralized web application to organize and monitor financial activities through the following features:

1. **Dashboard:** Displays a summary of income, expenses, and financial balances.
2. **Transactions:** Allows users to record and manage income and expense transactions.
3. **Wallets:** Helps track balances across supported payment methods.
4. **Split Expenses:** Helps manage shared expenses and track individual contributions.
5. **Khata:** Maintains records of money lent or borrowed and tracks repayments.
6. **Calendar:** Organizes financial transactions by date.
7. **Profile:** Provides access to user profile information and related settings.
8. **Authentication:** Supports user registration and login.
9. **Data Management:** Uses SQLite and browser storage for database persistence and supported local or offline functionality.
10. **DevOps Integration:** Uses Git, GitHub, Jenkins, SonarQube, Docker, and ngrok as part of the project's development and testing workflow, according to the configured setup.

## 4. Project Objectives

- To simplify personal income and expense tracking.
- To maintain financial records in one application.
- To monitor wallet balances and spending activities.
- To manage shared expenses, lending, and repayments.
- To provide a user-friendly interface for financial management.
- To understand version control, code analysis, containerization, and DevOps practices.

## 5. Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Structures the web pages |
| CSS3 | Styles the interface and provides responsive layouts |
| JavaScript | Implements frontend functionality |
| Node.js | Runs the backend application |
| Express.js | Handles server routes and API requests |
| SQLite | Stores structured application data |
| Git | Tracks source code changes |
| GitHub | Hosts the project repository |
| Jenkins | Executes configured automation pipelines |
| SonarQube | Analyzes code quality and identifies potential issues |
| Docker | Packages applications and their dependencies into containers |
| ngrok | Provides a public tunnel to a locally running service for testing or demonstration |

## 6. Main Features and Navigation Sections

### 6.1 Dashboard

Displays an overview of financial activities, including income, expenses, and balances.

### 6.2 Transactions

Allows users to add, view, and manage income and expense records.

### 6.3 Calendar

Organizes financial transactions by date, making it easier to review daily activities.

### 6.4 Khata

Maintains records of money lent or borrowed and helps track repayments.

### 6.5 Profile

Provides access to user profile information and available account-related settings.

### 6.6 Wallets

Helps users monitor balances across supported payment methods, such as cash and online payments.

### 6.7 Split Expenses

Supports the recording of shared expenses and tracking of amounts associated with different participants.

### 6.8 Login and Registration

Provides user login and registration interfaces for account access.

## 7. Installation and Execution

### Prerequisites

- Node.js and npm
- Git
- A modern web browser
- A code editor, such as Visual Studio Code

### Step 1: Clone the Repository

Replace the placeholder with your actual GitHub repository URL.

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
```

### Step 2: Open the Project Directory

```bash
cd Spendly
```

Use the actual directory name if it differs.

### Step 3: Install Backend Dependencies

```bash
cd backend
npm install
```

### Step 4: Start the Backend Server

Use the command configured in your project. For example:

```bash
npm start
```

Alternatively, if the server is started directly:

```bash
node server.js
```

### Step 5: Open the Application

Open the frontend using your project's configured local server or visit the local URL and port displayed by the backend if it serves the frontend.

**Note:** Verify the startup commands and port against your actual project configuration.

## 8. Git and GitHub

Git and GitHub are used to manage the source code and maintain the development history of Spendly.

The project workflow includes:

- Tracking changes using Git.
- Maintaining the source code in a GitHub repository.
- Recording meaningful updates through commits.
- Pushing changes to the remote repository.
- Reviewing commit history to track development progress.

For the assignment, maintain at least five meaningful changes with a genuine commit history and include screenshots of the repository and commits.

## 9. DevOps Tool Integration

The following tools are included in the project's DevOps workflow. Describe and show only the configurations and results you actually implemented.

### 9.1 ngrok

ngrok can expose a locally running application through a public tunnel, allowing access for testing or demonstration without directly configuring router port forwarding.

**Evidence:** Include the ngrok command prompt screenshot showing the tunnel configuration and relevant output. Hide authentication tokens and other sensitive information.

### 9.2 Jenkins

Jenkins is used to configure and execute automated development workflows. The project pipeline may include source-code checkout, build steps, and configured validation tasks.

**Evidence:** Include a screenshot of the Jenkins dashboard or job configuration.

### 9.3 Jenkins Build

The Jenkins build page and console output provide evidence of pipeline execution and the outcome of configured stages.

**Evidence:** Include the actual Jenkins build screenshot and console output showing the execution result.

### 9.4 SonarQube

SonarQube analyzes source code to identify potential bugs, maintainability issues, and code-quality concerns. Its dashboard can be used to review the analysis results.

**Evidence:** Include a screenshot of the SonarQube project dashboard or analysis results. Mention a quality gate result only if it is displayed and verified.

### 9.5 Docker

Docker packages an application and its dependencies into containers to support consistent execution across environments.

**Evidence:** Include screenshots showing your actual Docker setup, such as the image, container, build output, or running-container status, depending on what you implemented.

## 10. Screenshots and Evidence

Create a folder named `screenshots` in the repository and save your actual screenshots using the filenames suggested below.

### 10.1 Application Screenshots

**Dashboard**

<img width="1917" height="972" alt="Screenshot 2026-10-24 182320" src="https://github.com/user-attachments/assets/c087d2e6-95a4-4853-b8df-a5c096280630" />


*Figure 1: Dashboard showing an overview of financial activities.*

**Transactions**

<img width="1917" height="971" alt="image" src="https://github.com/user-attachments/assets/5590ea99-870c-46ad-9902-b6b251871687" />


*Figure 2: Transactions section for managing income and expenses.*

**Calendar**

<img width="1917" height="967" alt="Screenshot 2026-10-24 182449" src="https://github.com/user-attachments/assets/9eedacce-4998-40fe-87b9-6be487764801" />


*Figure 3: Calendar section displaying financial activities by date.*

**Khata**

<img width="1917" height="1021" alt="Screenshot 2026-10-24 182513" src="https://github.com/user-attachments/assets/d578076f-fbc8-4c6a-a8b4-f1cd3b2739d9" />


*Figure 4: Khata section for recording lending, borrowing, and repayments.*

**Profile**

<img width="1915" height="970" alt="Screenshot 2026-10-24 182540" src="https://github.com/user-attachments/assets/97f72833-9351-4309-a811-bb6cf4f7e861" />


*Figure 5: Profile section displaying user information and available settings.*

**Wallets**

<img width="1910" height="601" alt="Screenshot 2026-10-24 182614" src="https://github.com/user-attachments/assets/95d2ae82-1de4-4f14-affe-b742ab315745" />


*Figure 6: Wallets section for tracking supported payment methods and balances.*

**Split Expenses**

<img width="1917" height="882" alt="Screenshot 2026-10-24 182708" src="https://github.com/user-attachments/assets/550eb030-1688-4078-9d15-6809038d90fe" />


*Figure 7: Split Expenses section for managing shared expenses.*

**Login**

<img width="1898" height="973" alt="Screenshot 2026-10-24 181816" src="https://github.com/user-attachments/assets/06a8e27c-9eeb-4fdb-a512-9f1837d47521" />


*Figure 8: Login page for user authentication.*

**Registration**

<img width="683" height="796" alt="Screenshot 2026-10-24 182830" src="https://github.com/user-attachments/assets/fbda025a-143f-49ed-9794-369916378489" />


*Figure 9: Registration page for creating a user account.*

### 10.2 Git and GitHub Screenshots

**GitHub Repository**

<img width="1920" height="1080" alt="Screenshot (529)" src="https://github.com/user-attachments/assets/74ef91a8-3076-4eb0-8e2e-58d747488de1" />

*Figure 10: GitHub repository containing the Spendly source code.*

**Git Commit History**

<img width="1917" height="1017" alt="Screenshot 2026-10-24 220530" src="https://github.com/user-attachments/assets/ba5ea956-9c0e-4cac-a484-77f58b3c12bb" />

*Figure 11: Git commit history showing meaningful project updates.*

### 10.3 DevOps Screenshots

**ngrok Command Prompt**

<img width="1488" height="820" alt="Screenshot 2026-10-23 164505" src="https://github.com/user-attachments/assets/b32b62d2-cd4f-4583-a80e-0a3b70ad711e" />

*Figure 12: ngrok command prompt showing the tunnel configuration and output.*

**Jenkins Dashboard or Configuration**

<img width="1920" height="1080" alt="Screenshot (521)" src="https://github.com/user-attachments/assets/2e7cb160-077e-460a-b13c-90bbbcb7e48f" />

*Figure 13: Jenkins dashboard or job configuration for the project.*

**Jenkins Build Result**

<img width="1917" height="973" alt="image" src="https://github.com/user-attachments/assets/4be179e4-841e-4511-b7b1-180b08f9cd4e" />


*Figure 14: Jenkins build execution and actual result.*

**SonarQube Dashboard**
<img width="1917" height="1033" alt="Screenshot 2026-10-24 175922" src="https://github.com/user-attachments/assets/ea9231b3-45e0-4aea-ab3d-b878b5f75d8b" />


*Figure 15: SonarQube dashboard showing the project's code analysis results.*

**Docker Setup**

<img width="1642" height="965" alt="Screenshot 2026-10-24 180021" src="https://github.com/user-attachments/assets/42edb628-7ebe-4df2-9cfe-9521b8325ea9" />
<img width="1917" height="688" alt="image" src="https://github.com/user-attachments/assets/ebfdc283-3e56-4d50-ae8b-3f510e4ea9fa" />


*Figure 16: Docker image, container, build output, or running-container status.*


## 11. Conclusion

Spendly demonstrates how a web-based application can simplify personal financial management by bringing transaction tracking, wallet management, shared expenses, and repayment records into one platform.

The project also provides practical experience with frontend and backend development, database integration, version control, code-quality analysis, containerization, and DevOps automation. Through GitHub, Jenkins, SonarQube, Docker, and ngrok, the project connects application development with software development and testing practices.

