FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY execution-service/Syncode.ExecutionService.csproj execution-service/
RUN dotnet restore execution-service/Syncode.ExecutionService.csproj
COPY execution-service/ execution-service/
RUN dotnet publish execution-service/Syncode.ExecutionService.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish

FROM docker:27.5.1-cli AS docker-cli

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
ENV ASPNETCORE_URLS=http://0.0.0.0:5112 \
    TMPDIR=/execution-source \
    TMP=/execution-source \
    TEMP=/execution-source
USER 10001:10001
EXPOSE 5112
ENTRYPOINT ["dotnet", "Syncode.ExecutionService.dll"]
