using Microsoft.Extensions.Options;
using server.Config;

namespace server.Services;

public sealed class AiProviderClient(IOptions<AiProviderOptions> options)
{
    private readonly AiProviderOptions _options = options.Value;

    public BuiltInModelCatalog GetCatalog()
    {
        if (!_options.Enabled)
            return new BuiltInModelCatalog(false, []);

        return new BuiltInModelCatalog(
            true,
            [new BuiltInModel(_options.Model, _options.Model, "syncode", "builtin")]);
    }
}

public sealed record BuiltInModelCatalog(bool Available, IReadOnlyList<BuiltInModel> Models);

public sealed record BuiltInModel(string Id, string Name, string ProviderId, string Mode);
