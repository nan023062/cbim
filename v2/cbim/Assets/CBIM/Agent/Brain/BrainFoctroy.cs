using System;

namespace CBIM.AgentSystem;

public static class BrainFactory
{
    public static Brain Create(IBrainAgent agent, BrainDescriptor descriptor)
    {
        if (descriptor is ParietalLobeDescriptor parietalLobeDescriptor)
            return new ParietalLobe(agent, parietalLobeDescriptor);
        
        if (descriptor is PrefrontalDescriptor prefrontalDescriptor)
            return new PrefrontalCortex(agent, prefrontalDescriptor);
        
        if (descriptor is HippocampusDescriptor hippocampusDescriptor)
            return new Hippocampus(agent, hippocampusDescriptor);

        if (descriptor is ExternalMotorCortexDescriptor externalMotorCortexDescriptor)
        {
            throw new NotImplementedException( " externalMotorCortexDescriptor.EngineKind not implemented");
        }
        
        if (descriptor is MotorCortexDescriptor motorCortexDescriptor)
        {
            return new MotorCortex(agent,  motorCortexDescriptor);
        }
        
        
        throw new NotImplementedException(  $"{descriptor.GetType()} not implemented");
    }

    public static void Destroy(Brain brain)
    {
         brain.Dispose();
    }
}