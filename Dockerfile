FROM nginx:alpine

# Copy web application assets and PWA files to Nginx document root
COPY index.html /usr/share/nginx/html/
COPY login.html /usr/share/nginx/html/
COPY register.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY themes.css /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY theme.js /usr/share/nginx/html/
COPY manifest.json /usr/share/nginx/html/
COPY sw.js /usr/share/nginx/html/

# Expose port 80
EXPOSE 80

# Start Nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
