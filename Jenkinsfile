pipeline {
    agent any

    environment {
        DOCKER_IMAGE   = 'spendly:latest'
        CONTAINER_NAME = 'spendly'
        SCANNER_HOME   = tool 'sonar-scanner'
    }

    stages {
        stage('Checkout Code') {
            steps {
                checkout scm
            }
        }

        stage('Install Backend Dependencies') {
            steps {
                dir('backend') {
                    bat 'npm ci'
                }
            }
        }

        stage('API Tests and Coverage') {
            steps {
                bat 'backend\\node_modules\\.bin\\c8.cmd --all --include=backend/server.js --include=backend/database.js --include=sw.js --include=theme.js --reporter=text --reporter=lcov --reports-dir=backend/coverage node --test .\\backend\\test\\*.test.js'
            }
        }

        stage('SonarQube Analysis') {
            steps {
                withSonarQubeEnv('SonarQube') {
                    bat "\"${SCANNER_HOME}\\bin\\sonar-scanner.bat\""
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                bat 'docker build -t %DOCKER_IMAGE% .'
            }
        }

        stage('Deploy Container') {
            steps {
                bat '''
                    @echo off
                    docker rm -f %CONTAINER_NAME% >nul 2>&1
                    docker run -d --name %CONTAINER_NAME% -p 3000:80 %DOCKER_IMAGE%
                '''
            }
        }
    }
}
