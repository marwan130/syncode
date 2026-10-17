using Microsoft.AspNetCore.Mvc;
using server.Services;

namespace server.Controllers;

[ApiController]
[Route("api/ai")]
public sealed class AiController(AiProviderClient aiProviderClient) : ControllerBase
{
    [HttpGet("models")]
    public ActionResult<BuiltInModelCatalog> GetModels() =>
        Ok(aiProviderClient.GetCatalog());
}
