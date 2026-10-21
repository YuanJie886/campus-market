FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /workspace
COPY campus-market-backend/pom.xml campus-market-backend/mvnw campus-market-backend/mvnw.cmd ./campus-market-backend/
COPY campus-market-backend/.mvn ./campus-market-backend/.mvn
RUN mvn -f campus-market-backend/pom.xml -B dependency:go-offline
COPY campus-market-backend/src ./campus-market-backend/src
RUN mvn -f campus-market-backend/pom.xml -B package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /workspace/campus-market-backend/target/campus-market-backend-0.0.1-SNAPSHOT.jar app.jar
# 阶段 4：上传图片目录。命名卷第一次挂载时沿用这里的属主，非 root 进程才能写入
RUN mkdir -p /data/images && chown 10001 /data/images
USER 10001
EXPOSE 3000
ENTRYPOINT ["java", "-jar", "app.jar"]
