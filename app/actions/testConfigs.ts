"use server";

import prisma from '../lib/prisma';

export async function getTestConfigs() {
  try {
    const configs = await prisma.testConfig.findMany({
      include: { department: true },
      orderBy: { testName: 'asc' }
    });
    return configs;
  } catch (error) {
    console.error("Get test configs error:", error);
    return [];
  }
}

export async function addTestConfig(data: { testName: string; serviceCd?: string; shortName: string; departmentId: string; intervalTime: number; intervalTimeVerified?: number }) {
  try {
    const existing = await prisma.testConfig.findUnique({
      where: { testName: data.testName }
    });

    if (existing) {
      return { success: false, message: "Test already exists" };
    }

    const config = await prisma.testConfig.create({
      data: {
        testName: data.testName,
        serviceCd: data.serviceCd || null,
        shortName: data.shortName,
        departmentId: data.departmentId,
        intervalTime: data.intervalTime,
        intervalTimeVerified: data.intervalTimeVerified || null
      }
    });

    return { success: true, config };
  } catch (error) {
    console.error("Add test config error:", error);
    return { success: false, message: "Database error" };
  }
}

export async function updateTestConfig(id: string, data: { testName: string; serviceCd?: string; shortName: string; departmentId: string; intervalTime: number; intervalTimeVerified?: number }) {
  try {
    const existing = await prisma.testConfig.findUnique({
      where: { testName: data.testName }
    });

    if (existing && existing.id !== id) {
      return { success: false, message: "Another test with this name already exists" };
    }

    const config = await prisma.testConfig.update({
      where: { id },
      data: {
        testName: data.testName,
        serviceCd: data.serviceCd || null,
        shortName: data.shortName,
        departmentId: data.departmentId,
        intervalTime: data.intervalTime,
        intervalTimeVerified: data.intervalTimeVerified || null
      }
    });

    return { success: true, config };
  } catch (error) {
    console.error("Update test config error:", error);
    return { success: false, message: "Database error during update" };
  }
}

export async function removeTestConfig(id: string) {
  try {
    await prisma.testConfig.delete({
      where: { id }
    });
    return { success: true };
  } catch (error) {
    console.error("Remove test config error:", error);
    return { success: false, message: "Failed to remove" };
  }
}

export async function bulkAddTestConfigs(configs: { testName: string; serviceCd?: string; shortName: string; departmentId: string; intervalTime: number; intervalTimeVerified?: number }[]) {
  try {
    let addedCount = 0;
    for (const data of configs) {
      const existing = await prisma.testConfig.findUnique({
        where: { testName: data.testName }
      });
      
      if (!existing) {
        await prisma.testConfig.create({
          data: {
            testName: data.testName,
            serviceCd: data.serviceCd || null,
            shortName: data.shortName,
            departmentId: data.departmentId,
            intervalTime: data.intervalTime,
            intervalTimeVerified: data.intervalTimeVerified || null
          }
        });
        addedCount++;
      }
    }
    return { success: true, message: `Successfully added ${addedCount} configurations.` };
  } catch (error: any) {
    console.error("Bulk add test config error:", error);
    return { success: false, message: `Database error: ${error.message || 'Unknown error'}` };
  }
}

export async function clearAllTestConfigs() {
  try {
    await prisma.testConfig.deleteMany({});
    return { success: true };
  } catch (error) {
    console.error("Clear test configs error:", error);
    return { success: false, message: "Database error" };
  }
}
